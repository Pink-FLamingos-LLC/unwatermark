<script>
  let activeTab = $state('table');
  let searchQuery = $state('');
  let timerMinutes = $state(42);
  let searchPlaceholderIdx = $state(0);

  const placeholders = [
    'Search games or rules...',
    'Find a dice tool...',
    'Look up a Catan rule...',
    'Search your shelf...'
  ];

  const recentSessions = [
    { winner: 'Sarah', game: 'Wingspan', color: 'primary', icon: 'workspace_premium', time: '3 days ago', score: '84 pts' },
    { winner: 'Alex', game: 'Dune: Imperium', color: 'secondary', icon: 'emoji_events', time: '5 days ago', score: '12 VPs' }
  ];

  const tools = [
    { icon: 'looks_one', label: 'First Player', color: 'text-primary' },
    { icon: 'casino', label: 'Dice Roller', color: 'text-secondary' },
    { icon: 'timer', label: 'Timer', color: 'text-meeple-yellow' },
    { icon: 'monetization_on', label: 'Coin Flip', color: 'text-meeple-red' },
    { icon: 'calculate', label: 'Calculator', color: 'text-tertiary' }
  ];

  const shelf = [
    { title: 'Wingspan', rating: '4.8', players: '1-5P' },
    { title: 'Terraforming Mars', rating: '4.9', players: '1-5P' },
    { title: '7 Wonders', rating: '4.7', players: '2-7P' },
    { title: 'Catan', rating: '4.5', players: '3-4P' }
  ];

  const navTabs = [
    { id: 'table', icon: 'casino', label: 'Table' },
    { id: 'shelf', icon: 'shelves', label: 'Shelf' },
    { id: 'tools', icon: 'construction', label: 'Tools' },
    { id: 'history', icon: 'history', label: 'History' }
  ];

  let interval;

  $effect(() => {
    interval = setInterval(() => {
      searchPlaceholderIdx = (searchPlaceholderIdx + 1) % placeholders.length;
    }, 4000);
    return () => clearInterval(interval);
  });
</script>

<!-- Top App Bar -->
<header class="sticky top-0 z-50 flex items-center justify-between px-4 h-12 bg-surface-charcoal border-b border-white/10">
  <div class="flex items-center gap-3">
    <span class="material-symbols-outlined">menu</span>
    <h1 class="text-headline-lg-mobile font-bold text-primary">Tabletop Companion</h1>
  </div>
  <button class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-variant transition-colors">
    <span class="material-symbols-outlined">search</span>
  </button>
</header>

<main class="px-4 py-6 space-y-8 max-w-2xl mx-auto">

  <!-- Active Table -->
  <section>
    <h2 class="text-label-sm uppercase tracking-widest text-on-surface-variant mb-3">The Active Table</h2>
    <div class="wood-texture rounded-xl p-4 shadow-2xl relative">
      <div class="absolute top-4 right-4 bg-black/40 backdrop-blur-md rounded-full px-3 py-1 flex items-center gap-1.5 border border-white/10">
        <span class="material-symbols-outlined text-[18px] text-meeple-red animate-pulse">timer</span>
        <span class="text-label-lg text-white">{timerMinutes}m</span>
      </div>
      <div class="mb-6">
        <h3 class="text-display-lg text-white mb-1">Dune: Imperium</h3>
        <p class="text-body-md text-white/70 flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-[20px]" style="font-variation-settings: 'FILL' 1;">person</span>
          Current Turn: <span class="font-bold text-white">Sarah</span>
        </p>
      </div>
      <div class="flex gap-3">
        <button class="flex-1 bg-primary text-on-primary h-12 rounded-lg font-label-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
          <span class="material-symbols-outlined">play_arrow</span>
          Resume
        </button>
        <button class="w-12 h-12 border-2 border-white/20 rounded-lg flex items-center justify-center text-white active:scale-95 hover:bg-white/10 transition-all">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    </div>
  </section>

  <!-- Search -->
  <section>
    <div class="relative">
      <span class="absolute inset-y-0 left-4 flex items-center pointer-events-none material-symbols-outlined text-on-surface-variant">search</span>
      <input
        bind:value={searchQuery}
        class="w-full h-12 bg-surface-charcoal border border-white/10 rounded-xl pl-12 pr-4 text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all placeholder:text-on-surface-variant/50"
        placeholder={placeholders[searchPlaceholderIdx]}
        type="text"
      />
    </div>
  </section>

  <!-- Swiss Army Tools -->
  <section>
    <div class="flex justify-between items-end mb-4">
      <h2 class="text-label-sm uppercase tracking-widest text-on-surface-variant">Swiss Army Tools</h2>
      <button class="text-primary text-label-sm">View All</button>
    </div>
    <div class="flex overflow-x-auto gap-4 no-scrollbar pb-2 -mx-4 px-4">
      {#each tools as tool}
        <div class="flex flex-col items-center gap-2 min-w-[72px]">
          <button class="w-14 h-14 bg-surface-charcoal border border-white/10 rounded-xl flex items-center justify-center {tool.color} active:scale-90 transition-all shadow-lg hover:border-current/50">
            <span class="material-symbols-outlined text-[28px]">{tool.icon}</span>
          </button>
          <span class="text-label-sm text-on-surface-variant">{tool.label}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- My Shelf -->
  <section>
    <div class="flex justify-between items-end mb-4">
      <h2 class="text-label-sm uppercase tracking-widest text-on-surface-variant">My Shelf</h2>
      <button class="text-primary text-label-sm">Manage</button>
    </div>
    <div class="grid grid-cols-2 gap-4">
      {#each shelf as game}
        <div class="bg-surface-charcoal rounded-xl overflow-hidden border border-white/10 shadow-lg">
          <div class="h-40 bg-cover bg-center bg-surface-container"></div>
          <div class="p-3">
            <h4 class="text-label-lg text-on-surface truncate">{game.title}</h4>
            <div class="flex items-center gap-1 mt-1">
              <span class="material-symbols-outlined text-[14px] text-meeple-yellow" style="font-variation-settings: 'FILL' 1;">star</span>
              <span class="text-label-sm text-on-surface-variant">{game.rating} • {game.players}</span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Recent Sessions -->
  <section class="pb-8">
    <h2 class="text-label-sm uppercase tracking-widest text-on-surface-variant mb-4">Recent Sessions</h2>
    <div class="space-y-3">
      {#each recentSessions as s}
        <div class="bg-surface-charcoal border border-white/5 rounded-xl p-4 flex items-center gap-4 hover:border-white/20 transition-all cursor-pointer">
          <div class="w-12 h-12 rounded-full bg-{s.color}/20 flex items-center justify-center text-{s.color} shrink-0">
            <span class="material-symbols-outlined text-[24px]">{s.icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-body-md text-on-surface truncate">
              <span class="font-bold">{s.winner}</span> won <span class="text-{s.color} font-bold">{s.game}</span>
            </p>
            <p class="text-label-sm text-on-surface-variant mt-0.5">{s.time} • {s.score}</p>
          </div>
          <span class="material-symbols-outlined text-on-surface-variant">chevron_right</span>
        </div>
      {/each}
    </div>
  </section>

</main>

<!-- Bottom Navigation -->
<nav class="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 bg-surface-charcoal border-t border-white/10 shadow-[0_-4px_12px_rgba(0,0,0,0.5)] rounded-t-xl">
  {#each navTabs as tab}
    <button
      class="flex flex-col items-center justify-center {activeTab === tab.id ? 'bg-secondary-container text-on-secondary-container rounded-full px-4 py-1' : 'text-on-surface-variant hover:text-primary'} active:scale-95 transition-all duration-150"
      onclick={() => activeTab = tab.id}
    >
      <span class="material-symbols-outlined" style={activeTab === tab.id ? "font-variation-settings: 'FILL' 1" : ''}>{tab.icon}</span>
      <span class="text-label-sm">{tab.label}</span>
    </button>
  {/each}
</nav>
