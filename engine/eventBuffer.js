function createEventBuffer(limit = 500) {
  const max = Math.max(10, Number(limit) || 500);
  let nextId = 1;
  let items = [];

  function push(event) {
    const record = {
      id: nextId++,
      ts: Date.now(),
      ...event,
    };
    items.push(record);
    if (items.length > max) {
      items = items.slice(-max);
    }
    return record;
  }

  function list({ limit: take = 50, kinds } = {}) {
    let arr = items;
    if (Array.isArray(kinds) && kinds.length) {
      const allowed = new Set(kinds);
      arr = arr.filter((item) => allowed.has(item.kind));
    }
    return arr.slice(-Math.max(1, Number(take) || 50)).reverse();
  }

  function latest(kind) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!kind || items[i].kind === kind) return items[i];
    }
    return null;
  }

  function size() {
    return items.length;
  }

  return {
    push,
    list,
    latest,
    size,
  };
}

module.exports = { createEventBuffer };
