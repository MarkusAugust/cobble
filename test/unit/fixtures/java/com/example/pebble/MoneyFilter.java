package com.example.pebble;

import io.pebbletemplates.pebble.extension.Filter;
import java.util.List;
import java.util.Map;

public class MoneyFilter implements Filter {
    @Override
    public List<String> getArgumentNames() {
        return List.of("currency", "locale");
    }

    @Override
    public Object apply(Object input, Map<String, Object> args, PebbleTemplate self, EvaluationContext context, int lineNumber) {
        return input;
    }
}
