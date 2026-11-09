import { defineConfig } from 'vite';

// GitHub Pages(https://<ユーザー名>.github.io/ten-second-command/)でも動くよう、相対パスで出力する
export default defineConfig({
  base: './',
});
