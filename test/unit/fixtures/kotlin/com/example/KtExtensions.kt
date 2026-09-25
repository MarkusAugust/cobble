package com.example

import io.pebbletemplates.pebble.extension.AbstractExtension
import io.pebbletemplates.pebble.extension.Filter

class ShopExtension : AbstractExtension() {
    override fun getFilters(): Map<String, Filter> = mapOf("price" to PriceFilter())
}

class PriceFilter : Filter {
    override fun getArgumentNames(): List<String> = listOf("currency")
}
