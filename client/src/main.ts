import { createApp } from 'vue';
import App from './App.vue';
import { initTheme } from './composables/useTheme';
import './assets/main.css';
import './assets/markdown.css';

// 显式初始化主题：index.html 里的内联脚本已提前避免白闪，
// 这里只负责在应用启动时把状态与 DOM 对齐（不再依赖 import 副作用）。
initTheme();

createApp(App).mount('#app');
