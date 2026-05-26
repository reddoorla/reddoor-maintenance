<script>
  export let text = "click me";
  export let onclick;
</script>

<button on:click={onclick} class="rounded {$$props.class || ''}">
  {text}
</button>
