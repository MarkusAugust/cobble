package com.example.pebble;

import io.pebbletemplates.pebble.extension.Filter;

public class UnregisteredFilter implements Filter {
    public static final String FILTER_NAME = "slugify";
    public List<String> getArgumentNames() { return java.util.Arrays.asList("separator"); }
}
