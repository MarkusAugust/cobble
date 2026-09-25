package com.example

import io.ktor.server.application.*
import io.ktor.server.pebble.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Application.configureRouting(repo: ProductRepository) {
    routing {
        get("/products") {
            val products = repo.findAll()
            call.respond(PebbleContent("products/list.peb", mapOf("products" to products, "title" to "Products")))
        }
        get("/products/{id}") {
            val product = repo.find(call.parameters["id"]!!.toLong())
            val model = mutableMapOf<String, Any>()
            model["product"] = product
            model["cart"] = Cart(Customer(null, "x"))
            call.respondTemplate("products/detail.peb", model)
        }
    }
}

class ProductRepository {
    fun findAll(): List<Product> = emptyList()
    fun find(id: Long): Product = Product(id, "x", 1.0, "s")
}
