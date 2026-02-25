<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <div class="app-shell">
    <nav class="app-nav">
      <span class="nav-brand">Silo</span>

      <div class="nav-tabs">
        <NuxtLink
          to="/"
          class="nav-tab"
          :class="{ active: route.path === '/' }"
        >
          Scene Viewer
        </NuxtLink>
        <NuxtLink
          to="/browser"
          class="nav-tab"
          :class="{ active: route.path === '/browser' }"
        >
          Browser
        </NuxtLink>
      </div>
    </nav>

    <div class="app-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  height: 44px;
  padding: 0 clamp(1rem, 2vw, 2rem);
  border-bottom: 1px solid #d7ddd3;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(6px);
  font-family: 'Spectral', 'Georgia', serif;
  flex-shrink: 0;
}

.nav-brand {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #223132;
  text-transform: uppercase;
}

.nav-tabs {
  display: flex;
  gap: 0;
  height: 100%;
}

.nav-tab {
  display: flex;
  align-items: center;
  padding: 0 1rem;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: #587171;
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.nav-tab:hover {
  color: #334446;
}

.nav-tab.active {
  color: #223132;
  border-bottom-color: #5e9aa4;
  font-weight: 600;
}

.app-content {
  flex: 1;
  min-height: 0;
}
</style>
