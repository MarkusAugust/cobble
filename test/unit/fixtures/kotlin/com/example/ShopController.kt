package com.example

import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.servlet.ModelAndView

@Controller
class ShopController(private val repo: ProductRepository) {

    @GetMapping("/shop")
    fun shop(model: Model): String {
        model["products"] = repo.findAll()
        model.addAttribute("cart", Cart(Customer("a", "b")))
        return "shop/index"
    }

    @GetMapping("/shop/{id}")
    fun item(id: Long): ModelAndView = ModelAndView("shop/item", mapOf("product" to repo.find(id)))
}
