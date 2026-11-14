'use strict';

// Temas partilhados pelos três módulos. Cada tema tem uma paleta (cor escura, cor clara e seis cores
// de destaque), um par de tipos de letra (títulos e texto) e um elemento gráfico para os diapositivos.
// Os desenhos e os nomes são próprios desta aplicação.
(function () {
  const MO = (window.MO = window.MO || {});
  const { h } = MO;

  // Só tipos de letra presentes nos sistemas operativos; os ficheiros guardam apenas a chave.
  const FONTS = {
    sans: '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    classica: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
    redonda: '"Trebuchet MS", Verdana, Tahoma, sans-serif',
    humanista: 'Verdana, Tahoma, "DejaVu Sans", sans-serif',
    geometrica: '"Century Gothic", "Gill Sans", "Trebuchet MS", Arial, sans-serif',
    condensada: '"Arial Narrow", "Franklin Gothic Medium", "Liberation Sans Narrow", Arial, sans-serif',
    mono: '"Courier New", Courier, monospace'
  };

  // Elementos gráficos dos diapositivos (ver as regras .deco-* em app.css).
  const DECOS = ['linha', 'barra', 'faixa', 'lateral', 'arco', 'canto', 'moldura'];

  const LIST = [
    { id: 'escritorio', name: 'Escritório', head: 'sans', body: 'sans', dark: '#1c2130', light: '#ffffff', deco: 'linha', accents: ['#1f5fbf', '#c8491f', '#7a7f8c', '#e0a800', '#3b8ed0', '#4e9a3a'] },
    { id: 'executivo', name: 'Executivo', head: 'serif', body: 'sans', dark: '#14213d', light: '#ffffff', deco: 'barra', accents: ['#b8860b', '#14213d', '#7d8597', '#a44a3f', '#3d5a80', '#6b705c'] },
    { id: 'oceano', name: 'Oceano', head: 'geometrica', body: 'sans', dark: '#0f2f4f', light: '#ffffff', deco: 'faixa', accents: ['#0e7fc2', '#19b3c8', '#1d4e89', '#4fc3f7', '#2a9d8f', '#7bdff2'] },
    { id: 'floresta', name: 'Floresta', head: 'redonda', body: 'redonda', dark: '#14432a', light: '#fbfdf9', deco: 'lateral', accents: ['#2e8b57', '#8ab17d', '#e9c46a', '#14532d', '#6a994e', '#bc6c25'] },
    { id: 'por-do-sol', name: 'Pôr do sol', head: 'geometrica', body: 'humanista', dark: '#4a2318', light: '#fffaf5', deco: 'arco', accents: ['#e4572e', '#f3a712', '#a8201a', '#ec9a29', '#143642', '#0f8b8d'] },
    { id: 'coral', name: 'Coral', head: 'sans', body: 'sans', dark: '#3b2a2a', light: '#ffffff', deco: 'canto', accents: ['#e8685f', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#b56576'] },
    { id: 'menta', name: 'Menta', head: 'humanista', body: 'sans', dark: '#12342d', light: '#ffffff', deco: 'linha', accents: ['#1fb08f', '#0b6b57', '#74c69d', '#40916c', '#ffb703', '#219ebc'] },
    { id: 'lavanda', name: 'Lavanda', head: 'classica', body: 'sans', dark: '#2c2145', light: '#ffffff', deco: 'arco', accents: ['#8a63d2', '#4c2f91', '#c77dff', '#5e60ce', '#f28482', '#84a59d'] },
    { id: 'areia', name: 'Areia', head: 'classica', body: 'serif', dark: '#3e3024', light: '#fdfaf3', deco: 'moldura', accents: ['#c08a3e', '#5b4636', '#a3b18a', '#bc6c25', '#606c38', '#dda15e'] },
    { id: 'grafite', name: 'Grafite', head: 'condensada', body: 'sans', dark: '#22252b', light: '#ffffff', deco: 'barra', accents: ['#f2a33a', '#4a5263', '#9aa1b1', '#e76f51', '#2a9d8f', '#577590'] },
    { id: 'noite', name: 'Noite', head: 'geometrica', body: 'sans', dark: '#101426', light: '#f6f7ff', deco: 'canto', accents: ['#7c8cff', '#48bfe3', '#ff6b9d', '#64dfdf', '#ffd166', '#b5179e'] },
    { id: 'tecnico', name: 'Técnico', head: 'mono', body: 'sans', dark: '#1f2933', light: '#ffffff', deco: 'faixa', accents: ['#33658a', '#86bbd8', '#2f4858', '#f6ae2d', '#f26419', '#55828b'] },
    { id: 'contraste', name: 'Contraste', head: 'sans', body: 'sans', dark: '#000000', light: '#ffffff', deco: 'moldura', accents: ['#ffd400', '#00e5ff', '#ff5cf4', '#7cff6b', '#ff8a00', '#ffffff'] }
  ];

  // Variantes de cada tema, como alternativas de cor do mesmo desenho.
  const VARIANTS = [
    { id: 'claro', name: 'Claro' },
    { id: 'suave', name: 'Suave' },
    { id: 'vivo', name: 'Vivo' },
    { id: 'escuro', name: 'Escuro' }
  ];

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (parts) => '#' + parts.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

  // Mistura duas cores: t = 0 devolve a, t = 1 devolve b.
  function mix(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return hex(x.map((v, i) => v + (y[i] - v) * t));
  }

  function luminance(color) {
    const [r, g, b] = rgb(color).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // Das duas cores, a que se lê melhor sobre o fundo dado.
  const readable = (bg, a, b) => (contrast(bg, a) >= contrast(bg, b) ? a : b);

  const byId = (id) => LIST.find((t) => t.id === id) || LIST[0];

  const MIN_CONTRAST = 4.5; // mínimo recomendado para texto (WCAG AA)

  // Aproxima a cor de `towards` até o texto `fg` se ler bem sobre ela.
  function tuned(color, towards, fg) {
    let out = color;
    for (let t = 0.1; contrast(out, fg) < MIN_CONTRAST && t <= 1; t += 0.1) out = mix(color, towards, t);
    return out;
  }

  // Cores e tipos de letra de um diapositivo para um tema e uma variante.
  function slideLook(theme, variantId) {
    const [a1, a2] = theme.accents;
    const { dark, light } = theme;
    let bg = light;
    let title = dark;
    let accent = a1;
    if (variantId === 'suave') {
      bg = mix(a1, light, 0.88);
      title = tuned(mix(a1, dark, 0.6), dark, bg);
    } else if (variantId === 'vivo') {
      // O fundo é a cor de destaque, escurecida ou aclarada o necessário para o texto se ler.
      title = readable(a1, light, dark);
      bg = tuned(a1, title === light ? dark : light, title);
      accent = contrast(bg, a2) >= 1.6 ? a2 : title;
    } else if (variantId === 'escuro') {
      bg = dark;
      title = light;
      accent = contrast(bg, a1) >= 1.6 ? a1 : a2;
    } else {
      variantId = 'claro';
    }
    const soft = mix(title, bg, 0.18);
    return {
      id: theme.id,
      variant: variantId,
      name: theme.name,
      bg,
      title,
      text: contrast(bg, soft) >= MIN_CONTRAST ? soft : title,
      accent,
      font: theme.body,
      headFont: theme.head,
      deco: theme.deco
    };
  }

  // Tipos de letra e cores de um documento de texto.
  function docLook(theme) {
    const heading = mix(theme.accents[0], theme.dark, 0.35);
    return {
      body: FONTS[theme.body],
      head: FONTS[theme.head],
      color: contrast('#ffffff', heading) >= 4.5 ? heading : theme.dark,
      accent: theme.accents[0]
    };
  }

  // Estilos de tabela da folha de cálculo: um por cada cor de destaque.
  function tableStyles(theme) {
    return theme.accents
      .filter((accent) => contrast('#ffffff', accent) > 1.15)
      .map((accent, i) => ({
        name: 'Destaque ' + (i + 1),
        head: accent,
        headText: readable(accent, '#ffffff', theme.dark),
        band: mix(accent, '#ffffff', 0.86)
      }));
  }

  // Cores do tema oferecidas nos seletores de cor (lista associada por id).
  function setPickerColors(listId, theme) {
    let list = document.getElementById(listId);
    if (!list) {
      list = h('datalist', { id: listId });
      document.body.append(list);
    }
    const colors = [theme.dark, theme.light, ...theme.accents, ...theme.accents.slice(0, 4).map((c) => mix(c, '#ffffff', 0.6)), '#c62828', '#fff3a3'];
    list.replaceChildren(...[...new Set(colors)].map((value) => h('option', { value })));
  }

  // Miniatura de um tema para as galerias do friso.
  function chip(theme, onPick) {
    const btn = MO.toolButton(
      [
        h('span', { class: 'theme-bar', style: { background: theme.accents[0] } }),
        h('span', { class: 'theme-title', style: { color: theme.dark, fontFamily: FONTS[theme.head] } }, 'Aa'),
        h('span', { class: 'theme-swatches' }, theme.accents.map((color) => h('span', { style: { background: color } }))),
        h('span', { class: 'theme-name', style: { fontFamily: FONTS[theme.body] } }, theme.name)
      ],
      'Aplicar o tema ' + theme.name,
      () => onPick(theme),
      'theme-chip'
    );
    btn.dataset.theme = theme.id;
    return btn;
  }

  const gallery = (onPick) => LIST.map((theme) => chip(theme, onPick));

  // Assinala o tema em uso numa galeria.
  function markActive(container, themeId) {
    container.querySelectorAll('.theme-chip[data-theme]').forEach((el) => el.classList.toggle('active', el.dataset.theme === themeId));
  }

  MO.Themes = { FONTS, DECOS, LIST, VARIANTS, byId, slideLook, docLook, tableStyles, setPickerColors, gallery, markActive, mix, contrast };
})();
