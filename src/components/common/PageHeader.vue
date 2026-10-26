<template>
  <header class="bar">
    <button
      ref="backButton"
      type="button"
      class="icon-button back"
      :aria-label="i18n.back"
      :title="i18n.back"
      @click="emit('back')"
    >
      <IconChevronLeft />
    </button>
    <h1 class="bar-title">{{ title }}</h1>
    <slot></slot>
  </header>
</template>
<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";
import IconChevronLeft from "lucide-static/icons/chevron-left.svg";

defineProps<{ title: string }>();
const emit = defineEmits<{ back: [] }>();
const backButton = useTemplateRef<HTMLButtonElement>("backButton");

onMounted(() => {
  backButton.value?.focus();
});
</script>
