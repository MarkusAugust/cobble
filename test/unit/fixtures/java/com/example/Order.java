package com.example;

import lombok.Data;

@Data
public class Order {
    private String number;
    private java.math.BigDecimal total;
}
