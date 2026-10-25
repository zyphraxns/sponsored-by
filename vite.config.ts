import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径产物：可托管到任意静态路径（GitHub Pages 子路径也成立）
  base: './',
  build: {
    rollupOptions: {
      // 多页入口（相对 root 解析）：index = 工具本体；verify-* = 各导出管线自检页
      input: {
        index: 'index.html',
        verify: 'verify-export.html',
        'verify-gif': 'verify-gif.html',
        'verify-mp4': 'verify-mp4.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
