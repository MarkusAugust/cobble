package com.example;

import io.pebbletemplates.pebble.extension.Filter;
import java.util.List;

public class MoneyFilter implements Filter {
    public List<String> getArgumentNames() { return List.of("currency"); }
}
