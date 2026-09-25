package com.example

import java.time.LocalDate

data class Product(val id: Long, val name: String, val price: Double, private val secret: String) {
    val displayName: String get() = name.uppercase()
    fun discounted(): Double = price * 0.9
    private fun internalOnly() = 1
}

class Cart(val owner: Customer) {
    var items: List<Product> = emptyList()
    private var mutableThing = 2
    val total: Double
        get() = items.sumOf { it.price }
    fun isEmpty(): Boolean = items.isEmpty()
}

data class Customer(val email: String?, val name: String)

object Config {
    val version = "1.0"
}
