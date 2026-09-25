package com.example;

import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;

@ControllerAdvice
public class GlobalAdvice {
    @ModelAttribute("year")
    public Integer year() { return 2026; }

    @ModelAttribute
    public Settings settings() { return new Settings(); }
}
