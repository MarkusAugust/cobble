package com.example;

import java.util.List;
import java.util.Optional;

public class UserService {
    public List<User> findAll() { return List.of(); }
    public Optional<User> findById(Long id) { return Optional.empty(); }
    public User current() { return new User(); }
}
