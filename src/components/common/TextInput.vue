<template>
  <div>
    <label>{{ label }}</label>
    <input
      ref="textInput"
      :type="type ? type : 'text'"
      class="input"
      :value="model"
      @input="model = ($event.target as HTMLInputElement).value"
      @keyup.enter="emit('enter')"
    />
  </div>
</template>
<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";

const props = defineProps<{
  label?: string;
  type?: string;
  autofocus?: boolean;
}>();
const model = defineModel<string>();
const emit = defineEmits<{ enter: [] }>();
const textInput = useTemplateRef<HTMLInputElement>("textInput");

onMounted(() => {
  if (!props.autofocus) {
    return;
  }
  textInput.value?.focus();
});
</script>
