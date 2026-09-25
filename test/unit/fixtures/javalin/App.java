import io.javalin.Javalin;
import java.util.Map;

public class App {
    public static void main(String[] args) {
        var app = Javalin.create();
        app.get("/hello", ctx -> ctx.render("hello.peb", Map.of("greeting", "Hi", "count", 3)));
    }

    static void plain(PebbleEngine engine, Writer writer) throws IOException {
        PebbleTemplate template = engine.getTemplate("emails/welcome");
        Map<String, Object> context = new HashMap<>();
        context.put("customer", new Customer("a", "b"));
        template.evaluate(writer, context);
    }
}
