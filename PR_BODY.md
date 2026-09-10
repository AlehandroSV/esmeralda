## Summary

Complete developer experience for Jade ORM. Single entry point, watch mode, and auto-migration.

### New Features

#### `jade.init()` — Single Entry Point
```lua
local models = jade.init("schema/models.jade")
-- Done. Configure + sync + loadModels in one call.

models.User:create({ name = "Alice" })
models.User:getAll()
```

#### `esmeralda dev` — Watch Mode
```bash
esmeralda dev              # Watch .jade, auto-regenerate models
esmeralda dev --run        # Also auto-apply migrations
```

#### `esmeralda generate --run` — Generate + Apply
```bash
esmeralda generate --run   # Generate models + migration + apply
```

### API Summary

```lua
-- One-liner setup
local models = jade.init("schema/models.jade")

-- Lazy-loaded CRUD
models.User:create(data)
models.User:find(id)
models.User:getAll()
models.User:where(...)
models.User:update(id, data)
models.User:delete(id)
models.User:paginate(opts)
models.User:include("Posts"):get()

-- Cache management
models:reload("User")    -- reload one
models:reload()           -- reload all
models:clearCache()       -- clear all
```

### Files Changed

- `jade/src/jade/init.lua` — jade.init(), loadModels(), Seed module
- `jade/src/jade/schema/declarative.lua` — generateFullModel, generateMigration
- `esmeralda/src/cli/generate.ts` --run flag
- `esmeralda/src/cli/dev.ts` — watch mode (new)
- `esmeralda/src/bin/esmeralda.ts` — register dev command

### Tests

- 210/210 Esmeralda
- 684/684 Jade
