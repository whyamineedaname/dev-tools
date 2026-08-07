import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useThemeStore } from './stores/theme'
import { useMenuStore } from './stores/menu'
import './style.css'

const app = createApp(App)
app.use(createPinia())

// 应用启动即加载已保存的主题并写入 CSS 变量，避免默认主题闪烁
useThemeStore().init()
// 加载自定义菜单图标覆盖
useMenuStore().init()

app.mount('#app')