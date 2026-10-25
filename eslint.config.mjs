// Obsidian's own review rules, run locally so the community directory scan has no surprises.
// Biome handles general linting and dprint handles formatting; this file is only for Obsidian rules.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    globalIgnores(["main.js", "node_modules", "dist", "test", "scripts", ".test-build", "*.mjs"]),
    ...obsidianmd.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    brands: ["Plane", "Obsidian", "Clearline Books"],
                    acronyms: ["URL", "API"],
                    enforceCamelCaseLower: true,
                },
            ],
        },
    },
]);
