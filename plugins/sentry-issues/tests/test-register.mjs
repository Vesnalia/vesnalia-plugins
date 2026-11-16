import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/test-loader.mjs", pathToFileURL("./"));
