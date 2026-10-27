<template>
  <div class="group-field">
    <a-text-input
      v-model="model"
      class="group-input"
      :label="i18n.group"
      :optional="i18n.optional"
      :readonly="readonly"
      :maxlength="GROUP_MAX_LENGTH"
      @change="emit('change')"
    />
    <div
      v-if="!readonly && accounts.groupNames.length"
      class="group-chips"
      role="group"
      :aria-label="i18n.group_suggestions"
    >
      <button
        v-for="name in accounts.groupNames"
        :key="name"
        type="button"
        class="chip"
        :aria-pressed="groupKey(name) === groupKey(model)"
        @mousedown.prevent
        @click="choose(name)"
      >
        {{ name }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { GROUP_MAX_LENGTH, groupKey } from "../../groups";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";

defineProps<{ readonly?: boolean }>();
const model = defineModel<string>({ default: "" });
const emit = defineEmits<{ change: [] }>();

const accounts = useAccountsStore();

function choose(name: string) {
  model.value = name;
  emit("change");
}
</script>
