# backend-foundation 探针（MAYNE-20）

隔离验证独立 Rust 存储适配与主机运行边界的 harness。设计、矩阵与边界见
[docs/engineering/backend-foundation-probes.md](../../../docs/engineering/backend-foundation-probes.md)。

```sh
node tests/probes/backend-foundation/run-probes.mjs
```

- `storage-adapter-probe/`：独立 Rust crate，按目标契约写的参考实现（仅验证用，不进生产）。依赖版本与 `src-tauri/Cargo.lock` 一致，`--offline` 构建，target 固定在 `build/backend-foundation/target`。
- `run-probes.mjs`：Node 运行器。构建 harness、播种合成根、执行全部场景（含 `SIGKILL` 崩溃与调度拒绝），原始证据写 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），退出码 0 表示全部通过。
- 只使用合成根与合成钥匙串 fixture；不打开真实库、不读真实凭据、不动真实工作根；不改 `src-tauri/` 与 `package.json`。
