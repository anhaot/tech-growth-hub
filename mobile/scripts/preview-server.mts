import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tgh-app-preview-'));
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_TYPE: 'sqlite', ALLOWED_ORIGINS: 'http://127.0.0.1:18888,http://localhost:18888,http://127.0.0.1:18889',
  SQLITE_PATH: path.join(directory, 'test.db'), DATABASE_RUNTIME_CONFIG_PATH: path.join(directory, 'runtime.json'),
  OPENAI_API_KEY: '', DEEPSEEK_API_KEY: '', QWEN_API_KEY: '', DOUBAO_API_KEY: '', WENXIN_API_KEY: '', ZHIPU_API_KEY: '', JWT_SECRET: 'app-preview-test-secret', AI_CONFIG_ENCRYPTION_KEY: '2'.repeat(64), AI_ENABLED: 'true',
  INIT_ADMIN_USERNAME: 'preview', INIT_ADMIN_EMAIL: 'preview@example.com', INIT_ADMIN_PASSWORD: 'Preview12345', INIT_ADMIN_FORCE_PASSWORD_CHANGE: 'false' });
const { db } = await import('../../api/src/database/index.ts');
const { createApp } = await import('../../api/src/app.ts');
const { aiService } = await import('../../api/src/services/ai.ts');
await db.connect();
const { ApiClient } = await import('../../mobile/src/api.ts');
const server = createApp().listen(18183, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const api = new ApiClient('http://127.0.0.1:18183');
const login = await api.login('preview', 'Preview12345');
const signed = new ApiClient(api.server, login.token);
const linux = await signed.request<{id: string}>('/categories', 'POST', { name: 'Linux 运维' });
const network = await signed.request<{id: string}>('/categories', 'POST', { name: '计算机网络' });
for (const question of [
  { title: '如何排查 Linux CPU 占用过高？', content: '生产服务出现响应变慢，如何定位消耗 CPU 的进程？', answer: '先用 `top` 观察整体负载，再按 **P** 找出高 CPU 进程。\n\n1. 确认消耗 CPU 的进程。\n2. 用 `pidstat -p PID 1` 观察变化。\n3. 结合日志判断是否有异常循环。', explanation: '从 **系统 → 进程 → 线程** 逐层定位。\n\n负载高不一定代表 CPU 忙，也可能是磁盘 I/O 等待。先看 CPU 的 `us`、`sy`、`wa` 分布，再决定下一步。', difficulty: 'medium', categoryId: linux.id },
  { title: 'Linux 内存不足时如何排查？', content: '如何区分应用内存和文件缓存？', answer: '使用 `free -h`，重点观察 **available**。\n\n```bash\nfree -h\nps aux --sort=-%mem | head\n```', explanation: '文件缓存可以回收。不要只用 free 列判断内存是否不足。', difficulty: 'easy', categoryId: linux.id },
  { title: 'TCP 三次握手为什么不能只做两次？', content: '说明三次握手确认的能力和连接状态。', answer: '双方需要确认彼此的发送能力和接收能力。', explanation: '第三次握手让服务端确认客户端收到了自己的响应。', difficulty: 'hard', categoryId: network.id },
]) await signed.createQuestion(question as any);
await db.createAIConfig({ id: '3b1de98a-ccbe-46b8-93b5-83ea6c88a3c7', user_id: login.user.id, provider: 'openai', display_name: '预览模型', api_key: 'not-real', model: 'preview', is_active: true, is_custom: false });
aiService.getProvider = async () => ({ name: 'preview', chat: async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  return '可以从三个层次理解：\n\n1. **先看整体**：用 `top` 观察系统负载。\n2. **定位进程**：找出 CPU 占用最高的进程。\n3. **结合现象**：查看日志和线程状态。\n\n把它记成“整体、进程、原因”。';
}});
console.log('Isolated app preview ready: http://127.0.0.1:18183');
const shutdown = async () => { server.close(); await db.close(); fs.rmSync(directory, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
