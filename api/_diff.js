// Menyusun daftar perubahan yang mudah dibaca dari data lama ke data baru, untuk log.

const MAX_CHANGES = 100;

function coupleName(node, i) {
  const u = (node.unions || [])[i];
  return u && u.spouse ? node.name + " + " + u.spouse : node.name;
}

function countDesc(node) {
  let c = 0;
  (node.unions || []).forEach((u) => u.children.forEach((k) => (c += 1 + countDesc(k))));
  return c;
}

function flatten(root) {
  const map = new Map();
  (function walk(node, parent, ui) {
    map.set(node.id, {
      node,
      parentId: parent ? parent.id : null,
      parentLabel: parent ? coupleName(parent, ui) : "",
    });
    (node.unions || []).forEach((u, i) => u.children.forEach((c) => walk(c, node, i)));
  })(root, null, 0);
  return map;
}

function sameSet(a, b) {
  return a.length === b.length && a.slice().sort().join() === b.slice().sort().join();
}

function describeChanges(oldRoot, newRoot) {
  const before = flatten(oldRoot);
  const after = flatten(newRoot);
  const changes = [];
  const push = (kind, text) => changes.push({ kind, text });

  after.forEach((p, id) => {
    if (!before.has(id)) push("add", p.node.name + ", anak dari " + p.parentLabel);
  });

  before.forEach((p, id) => {
    // Keturunan dari orang yang dihapus cukup dihitung pada orang tersebut
    if (after.has(id) || (p.parentId && !after.has(p.parentId))) return;
    const desc = countDesc(p.node);
    push("remove", p.node.name + " (anak dari " + p.parentLabel + ")" + (desc ? " beserta " + desc + " keturunannya" : ""));
  });

  after.forEach((p, id) => {
    const old = before.get(id);
    if (!old) return;
    const name = p.node.name;
    if (old.node.name !== name) push("edit", "Nama " + old.node.name + " → " + name);
    if (old.parentId !== p.parentId) push("edit", name + " dipindah menjadi anak dari " + p.parentLabel);

    const ou = old.node.unions || [];
    const nu = p.node.unions || [];
    for (let i = 0; i < Math.max(ou.length, nu.length); i++) {
      const os = (ou[i] && ou[i].spouse) || "";
      const ns = (nu[i] && nu[i].spouse) || "";
      if (!os && ns) push("add", "Pasangan " + ns + " untuk " + name);
      else if (os && !ns) push("remove", "Pasangan " + os + " dari " + name);
      else if (os !== ns) push("edit", "Pasangan " + name + ": " + os + " → " + ns);
      const ol = (ou[i] && ou[i].label) || "";
      const nl = (nu[i] && nu[i].label) || "";
      if (ns && ol !== nl) push("edit", "Keterangan pasangan " + ns + ": " + (ol || "(kosong)") + " → " + (nl || "(kosong)"));
      const oc = ou[i] ? ou[i].children.map((c) => c.id) : [];
      const nc = nu[i] ? nu[i].children.map((c) => c.id) : [];
      if (oc.length > 1 && sameSet(oc, nc) && oc.join() !== nc.join()) push("edit", "Urutan anak " + coupleName(p.node, i) + " diubah");
    }
  });

  if (changes.length > MAX_CHANGES) {
    return { changes: changes.slice(0, MAX_CHANGES), more: changes.length - MAX_CHANGES };
  }
  return { changes, more: 0 };
}

module.exports = { describeChanges };
