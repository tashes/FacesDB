import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, "main.js"), // Adjust the entry point accordingly
            name: "FacesDB",
            fileName: (format) => `facesdb.${format}.js`,
            formats: ["es", "cjs"],
        },
        target: "node23",
        rollupOptions: {
            // Ensure to externalize dependencies not intended to be bundled
            external: [
                "chai",
                "dotenv",
                "path",
                "fs",
                "crypto",
                "os",
                "readline",
            ],
            output: {
                globals: {
                    chai: "chai",
                    dotenv: "dotenv",
                    path: "path",
                    fs: "fs",
                    crypto: "crypto",
                },
            },
        },
    },
});
