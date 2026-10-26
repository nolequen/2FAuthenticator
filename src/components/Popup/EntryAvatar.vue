<template>
  <span
    :class="{ letter: true, large, 'site-icon': loaded }"
    :style="loaded ? undefined : { background: issuerColor(issuer) }"
    aria-hidden="true"
    >{{ loaded ? "" : issuerLetter(issuer)
    }}<img
      v-if="icon && !failed"
      :class="{ loaded }"
      :src="icon"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="loaded = true"
      @error="failed = true"
  /></span>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  faviconUrl,
  issuerColor,
  issuerLetter,
  issuerSite,
} from "../../display";
import { useMenuStore } from "../../store/Menu";

const props = defineProps<{
  issuer: string;
  hash?: string;
  large?: boolean;
}>();

const menu = useMenuStore();
const loaded = ref(false);
const failed = ref(false);

const icon = computed(() =>
  menu.siteIcons && !menu.siteIconsOff.includes(props.hash ?? "")
    ? faviconUrl(issuerSite(props.issuer))
    : null,
);

watch(icon, () => {
  loaded.value = false;
  failed.value = false;
});
</script>
