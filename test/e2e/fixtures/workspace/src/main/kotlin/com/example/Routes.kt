package com.example

import io.ktor.server.application.*
import io.ktor.server.pebble.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

data class Product(val name: String, val price: Double)

fun Application.routes() {
    routing {
        get("/ktor") {
            call.respond(PebbleContent("pages/ktor.peb", mapOf("product" to Product("x", 1.0))))
        }
    }
}
