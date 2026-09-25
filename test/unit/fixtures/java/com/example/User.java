package com.example;

import java.util.List;
import java.time.LocalDate;

/** A user. Getters are how Pebble reads properties. */
public class User extends BaseEntity implements Named {
    private String name;
    private boolean active;
    private Address address;
    private List<Order> orders;
    public int loginCount;
    private static final String CONSTANT = "x";

    public String getName() { return name; }
    public boolean isActive() { return active; }
    public Address getAddress() { return address; }
    public List<Order> getOrders() { return orders; }
    public boolean hasOrders() { return !orders.isEmpty(); }
    public String displayName() { return name.toUpperCase(); }
    public void setName(String name) { this.name = name; }
    private String secret() { return "s"; }
    public static User of(String name) { return new User(); }
}
