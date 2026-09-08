/* Which repos the staff operate in.
 *
 * `org.yaml` carries a `repos:` list, and a role on each: `product` is one they contribute to
 * but do not own, which is what fills `works_in` on the next hire. Hand-editing that means
 * spelling a repo name exactly right in a YAML file, which is the kind of thing that fails
 * quietly and reads as the tool being broken. */

import { addRepo, listRepos } from "../api.js";
import { el } from "../dom.js";

/**
 * @param {{org: string, known: string[], onAdded?: () => void}} opts
 */
export function repoPicker(opts) {
  const box = el("div", { className: "manual" });
  box.append(
    el("b", { textContent: "Which repos the staff work in" }),
    el("p", {
      textContent:
        "Repos marked as products are the ones staff contribute to without owning. A new hire " +
        "picks them up automatically.",
    }),
  );

  const out = el("div", { style: "margin-top:9px" });
  box.append(out);
  out.replaceChildren(el("p", { className: "sub", textContent: "Reading your repos…" }));

  listRepos(opts.org)
    .then((data) => {
      if (data.error) throw new Error(data.error);
      const already = new Set(opts.known ?? []);
      const candidates = (data.repos ?? []).filter((r) => !already.has(r.name));

      if (!candidates.length) {
        out.replaceChildren(
          el("p", {
            className: "sub",
            textContent: (data.repos ?? []).length
              ? "Everything your gh can see in this org is already listed."
              : "Your gh cannot see any repos in this org. You can add them by hand in org.yaml.",
          }),
        );
        return;
      }

      const list = el("div", { className: "repolist" });
      for (const repo of candidates) {
        const row = el("div", { className: "repo" });
        const add = el("button", { className: "btn", textContent: "Add" });
        add.onclick = async () => {
          add.disabled = true;
          add.textContent = "Adding…";
          try {
            await addRepo(repo.name, "product");
            add.textContent = "Added";
            row.classList.add("added");
            opts.onAdded?.();
          } catch (err) {
            add.disabled = false;
            add.textContent = "Add";
            row.append(el("p", { className: "err", textContent: String(err.message || err) }));
          }
        };
        row.append(
          el("div", {}, [
            el("b", { textContent: repo.name }),
            el("span", { className: "meta", textContent: repo.visibility }),
            ...(repo.description
              ? [el("p", { className: "sub", textContent: repo.description })]
              : []),
          ]),
          add,
        );
        list.append(row);
      }
      out.replaceChildren(list);
    })
    .catch((err) => {
      out.replaceChildren(
        el("p", {
          className: "sub",
          textContent:
            "Could not list repos (" +
            String(err.message || err) +
            "). Add them by hand in org.yaml; nothing else is blocked by this.",
        }),
      );
    });

  return box;
}
