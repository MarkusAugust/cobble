package com.example;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.ModelAndView;

@Controller
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @ModelAttribute("siteName")
    public String siteName() { return "Cobble"; }

    @GetMapping
    public String list(Model model, @RequestParam(defaultValue = "1") int page) {
        List<User> users = userService.findAll();
        model.addAttribute("users", users);
        model.addAttribute("page", page);
        model.addAttribute("title", "Users");
        // a comment with "not a view" in it
        return "users/list";
    }

    @GetMapping("/{id}")
    public String detail(@PathVariable Long id, Model model) {
        var user = userService.findById(id).orElseThrow();
        model.addAttribute("user", user);
        model.addAttribute("orders", user.getOrders());
        model.addAttribute("current", userService.current());
        if (user.isActive()) {
            return "users/detail";
        }
        return "redirect:/users";
    }

    @PostMapping("/{id}")
    public ModelAndView update(@PathVariable Long id, @ModelAttribute("form") UserForm form) {
        ModelAndView mav = new ModelAndView("users/detail");
        mav.addObject("saved", true);
        return mav;
    }
}
