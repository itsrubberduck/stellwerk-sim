<script setup lang="ts">
import { computed } from 'vue'
import { avatarProfile, type AvatarId } from '../../shared/game'

const props = withDefaults(defineProps<{
  avatarId?: AvatarId | null
  size?: number
}>(), { avatarId: null, size: 48 })

const profile = computed(() => avatarProfile(props.avatarId))
const style = computed(() => ({
  '--avatar-color': profile.value.color,
  '--avatar-size': `${props.size}px`
}))
</script>

<template>
  <span class="avatar" :style="style" :title="profile.name">
    <span class="rings" />
    <img :src="profile.image" :alt="profile.name" />
  </span>
</template>

<style scoped>
.avatar { position: relative; display: inline-grid; place-items: center; width: var(--avatar-size); height: var(--avatar-size); flex: 0 0 auto; }
.rings { position: absolute; inset: 1px; border-radius: 50%; background: repeating-radial-gradient(circle, color-mix(in srgb, var(--avatar-color) 88%, white) 0 2px, transparent 3px 7px); box-shadow: 0 0 14px color-mix(in srgb, var(--avatar-color) 65%, transparent), inset 0 0 0 2px var(--avatar-color); }
img { position: relative; z-index: 1; width: 82%; height: 82%; object-fit: contain; object-position: center bottom; border-radius: 50%; filter: drop-shadow(0 2px 2px #000b); }
</style>
