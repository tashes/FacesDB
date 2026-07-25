import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        lib: {
            entry: {
                facesdb: resolve(__dirname, "main.js"),
                "maintenance-worker": resolve(__dirname, "lib/maintenanceWorker.js"),
            },
            name: "FacesDB",
            fileName: (format, entryName) => format === "cjs"
                ? `${entryName}.cjs`
                : `${entryName}.${format}.js`,
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
                "url",
                "worker_threads",
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
