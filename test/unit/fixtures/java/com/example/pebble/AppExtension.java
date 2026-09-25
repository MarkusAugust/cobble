package com.example.pebble;

import io.pebbletemplates.pebble.extension.AbstractExtension;
import io.pebbletemplates.pebble.extension.Filter;
import io.pebbletemplates.pebble.extension.Function;
import io.pebbletemplates.pebble.extension.Test;
import java.util.HashMap;
import java.util.Map;

public class AppExtension extends AbstractExtension {
    @Override
    public Map<String, Filter> getFilters() {
        Map<String, Filter> filters = new HashMap<>();
        filters.put("money", new MoneyFilter());
        filters.put("shout", new ShoutFilter());
        return filters;
    }

    @Override
    public Map<String, Function> getFunctions() {
        return Map.of("asset", new AssetFunction());
    }

    @Override
    public Map<String, Test> getTests() {
        return Map.of("adult", new AdultTest());
    }

    static class ShoutFilter implements Filter {
        public List<String> getArgumentNames() { return null; }
    }

    static class AssetFunction implements Function {
        private final List<String> argumentNames = new ArrayList<>();
        public AssetFunction() { argumentNames.add("path"); }
        public List<String> getArgumentNames() { return argumentNames; }
    }

    static class AdultTest implements Test {
        public List<String> getArgumentNames() { return null; }
    }
}
