// 모든 페이지에서 로드할 테마/언어 초기화
(function() {
  const theme = localStorage.getItem('tb_theme') || 'light';
  const lang = localStorage.getItem('tb_language') || 'ko';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('lang', lang === 'ko' ? 'ko' : 'en');

  // 다크 테마면 documentElement에 dark class 추가 (Tailwind dark mode)
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
})();
