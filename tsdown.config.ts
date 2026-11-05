import { defineConfig } from 'tsdown'

export default defineConfig([
    {
        entry: {
            'gc2-sdk': './src/index.ts'
        },
        dts: {
            sourcemap: true,
        },
        target: "es2017",
        platform: "browser",
        external: ['configstore', 'proper-lockfile', 'node:fs', 'node:os', 'node:path'],
        exports: false,
        format: ["esm", "cjs", "umd"],
        globalName: "GC2SDK"
    },
    {
        entry: {
            'gc2-sdk-node': './src/node.ts'
        },
        dts: {
            sourcemap: true,
        },
        target: "es2017",
        platform: "browser",
        external: ['configstore', 'proper-lockfile', 'node:fs', 'node:os', 'node:path'],
        exports: false,
        format: ["esm", "cjs"],
    }
])
