<template>
  <div class="field">
    <div v-if="label" class="field-label">
      <label :for="id">{{ label }}</label>
      <span v-if="optional" class="optional"> · {{ optional }}</span>
    </div>
    <input
      :id="id"
      ref="textInput"
      :type="type ? type : 'text'"
      class="input"
      :value="model"
      :placeholder="placeholder"
      :readonly="readonly"
      :aria-label="label ? undefined : ariaLabel"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${id}-error` : undefined"
      :spellcheck="spellcheck"
      :maxlength="maxlength"
      @input="model = ($event.target as HTMLInputElement).value"
      @change="emit('change')"
      @keyup.enter="emit('enter')"
    />
    <div v-if="error" :id="`${id}-error`" class="field-error">
      {{ error }}
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, useId, useTemplateRef } from "vue";

const props = defineProps<{
  label?: string;
  ariaLabel?: string;
  type?: string;
  autofocus?: boolean;
  placeholder?: string;
  optional?: string;
  readonly?: boolean;
  error?: string;
  spellcheck?: boolean;
  maxlength?: number;
}>();
const model = defineModel<string>();
const emit = defineEmits<{ enter: []; change: [] }>();
const id = useId();
const textInput = useTemplateRef<HTMLInputElement>("textInput");

onMounted(() => {
  if (!props.autofocus) {
    return;
  }
  textInput.value?.focus();
});
</script>
