import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './style.css';
import './styles/forms.css';
import './styles/settings.css';

createApp(App).use(createPinia()).mount('#app');
