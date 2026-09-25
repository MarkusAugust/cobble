package com.example;

import java.util.List;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {
    @GetMapping("/typed")
    public String typed(Model model) {
        User user = new User();
        model.addAttribute("user", user);
        model.addAttribute("items", List.of("a", "b"));
        return "pages/typed";
    }
}
