// For tools that start their browser with `node <script>`, like the linear CLI
// (LINEAR_PI_START_SCRIPT): start wb's headless Chrome instead.
process.argv.splice(2, process.argv.length, "start");
await import("./wb.mjs");
