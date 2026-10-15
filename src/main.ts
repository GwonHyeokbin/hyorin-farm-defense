import './style.css';
import { GameApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('게임 화면을 표시할 요소를 찾지 못했습니다.');
new GameApp(root);
