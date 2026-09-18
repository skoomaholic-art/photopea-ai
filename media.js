window.Media = (() => {
  const $ = id => document.getElementById(id);

  function status(message, kind = "") {
    const el = $("mediaStatus");
    el.textContent = message;
    el.className = "drawer-status" + (kind ? " " + kind : "");
  }

  function stripHtml(value) {
    const div = document.createElement("div");
    div.innerHTML = value || "";
    return div.textContent || "";
  }

  function year(value) {
    return value ? String(value).slice(0, 4) : "";
  }

  function tmdbHeaders() {
    return { Authorization: "Bearer " + APP.cfg.tmdb, Accept: "application/json" };
  }

  const providers = {
    tvmaze: {
      label: "TVmaze",
      enabled: () => true,
      async search(query) {
        const response = await fetch("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(query));
        if (!response.ok) throw new Error("TVmaze HTTP " + response.status);
        const rows = await response.json();
        return rows.map(row => {
          const show = row.show;
          return {
            provider: "TVmaze",
            providerKey: "tvmaze",
            id: show.id,
            title: show.name,
            originalTitle: show.name,
            year: year(show.premiered),
            type: "series",
            poster: show.image?.medium || show.image?.original || "",
            overview: stripHtml(show.summary),
            sourceUrl: show.url,
            raw: show
          };
        });
      },
      async details(item) {
        const [showResponse, imagesResponse] = await Promise.all([
          fetch("https://api.tvmaze.com/shows/" + item.id),
          fetch("https://api.tvmaze.com/shows/" + item.id + "/images")
        ]);
        if (!showResponse.ok) throw new Error("TVmaze details HTTP " + showResponse.status);
        const show = await showResponse.json();
        const images = imagesResponse.ok ? await imagesResponse.json() : [];
        return {
          overview: stripHtml(show.summary),
          meta: {
            Status: show.status,
            Runtime: show.runtime ? show.runtime + " min" : "",
            Genres: (show.genres || []).join(", "),
            Language: show.language || "",
            Network: show.network?.name || show.webChannel?.name || ""
          },
          artwork: images.map(image => ({
            url: image.resolutions?.original?.url || image.resolutions?.medium?.url,
            kind: image.type || "image",
            source: "TVmaze"
          })).filter(image => image.url)
        };
      }
    },

    omdb: {
      label: "OMDb",
      enabled: () => !!APP.cfg.omdb,
      async search(query) {
        const response = await fetch("https://www.omdbapi.com/?apikey=" + encodeURIComponent(APP.cfg.omdb) + "&s=" + encodeURIComponent(query));
        if (!response.ok) throw new Error("OMDb HTTP " + response.status);
        const data = await response.json();
        if (data.Response === "False") return [];
        return (data.Search || []).map(item => ({
          provider: "OMDb",
          providerKey: "omdb",
          id: item.imdbID,
          title: item.Title,
          originalTitle: item.Title,
          year: item.Year,
          type: item.Type,
          poster: item.Poster && item.Poster !== "N/A" ? item.Poster : "",
          overview: "",
          sourceUrl: "https://www.imdb.com/title/" + item.imdbID + "/",
          raw: item
        }));
      },
      async details(item) {
        const response = await fetch("https://www.omdbapi.com/?apikey=" + encodeURIComponent(APP.cfg.omdb) + "&i=" + encodeURIComponent(item.id) + "&plot=full");
        if (!response.ok) throw new Error("OMDb HTTP " + response.status);
        const data = await response.json();
        if (data.Response === "False") throw new Error(data.Error || "OMDb error");
        return {
          overview: data.Plot && data.Plot !== "N/A" ? data.Plot : "",
          meta: {
            Runtime: data.Runtime,
            Genres: data.Genre,
            Director: data.Director,
            Actors: data.Actors,
            IMDb: data.imdbRating,
            Awards: data.Awards
          },
          artwork: data.Poster && data.Poster !== "N/A" ? [{ url: data.Poster, kind: "poster", source: "OMDb" }] : []
        };
      }
    },

    tmdb: {
      label: "TMDB",
      enabled: () => !!APP.cfg.tmdb,
      async search(query) {
        const response = await fetch(
          "https://api.themoviedb.org/3/search/multi?query=" + encodeURIComponent(query) + "&language=ru-RU&include_adult=false",
          { headers: tmdbHeaders() }
        );
        if (!response.ok) throw new Error("TMDB HTTP " + response.status);
        const data = await response.json();
        return (data.results || [])
          .filter(item => item.media_type === "movie" || item.media_type === "tv")
          .map(item => ({
            provider: "TMDB",
            providerKey: "tmdb",
            id: item.id,
            title: item.title || item.name,
            originalTitle: item.original_title || item.original_name,
            year: year(item.release_date || item.first_air_date),
            type: item.media_type === "movie" ? "movie" : "series",
            poster: item.poster_path ? "https://image.tmdb.org/t/p/w500" + item.poster_path : "",
            backdrop: item.backdrop_path ? "https://image.tmdb.org/t/p/w780" + item.backdrop_path : "",
            overview: item.overview || "",
            sourceUrl: "https://www.themoviedb.org/" + (item.media_type === "movie" ? "movie/" : "tv/") + item.id,
            mediaType: item.media_type,
            raw: item
          }));
      },
      async details(item) {
        const type = item.mediaType || (item.type === "movie" ? "movie" : "tv");
        const base = "https://api.themoviedb.org/3/" + type + "/" + item.id;
        const [detailsResponse, imagesResponse] = await Promise.all([
          fetch(base + "?language=ru-RU", { headers: tmdbHeaders() }),
          fetch(base + "/images?include_image_language=ru,en,null", { headers: tmdbHeaders() })
        ]);
        if (!detailsResponse.ok) throw new Error("TMDB details HTTP " + detailsResponse.status);
        const details = await detailsResponse.json();
        const images = imagesResponse.ok ? await imagesResponse.json() : {};
        const artwork = [];
        (images.posters || []).slice(0, 12).forEach(image => artwork.push({
          url: "https://image.tmdb.org/t/p/w500" + image.file_path,
          kind: "poster",
          source: "TMDB",
          meta: { width: image.width, height: image.height, language: image.iso_639_1 }
        }));
        (images.backdrops || []).slice(0, 12).forEach(image => artwork.push({
          url: "https://image.tmdb.org/t/p/w780" + image.file_path,
          kind: "backdrop",
          source: "TMDB",
          meta: { width: image.width, height: image.height, language: image.iso_639_1 }
        }));
        (images.logos || []).slice(0, 10).forEach(image => artwork.push({
          url: "https://image.tmdb.org/t/p/w500" + image.file_path,
          kind: "logo",
          source: "TMDB",
          meta: { width: image.width, height: image.height, language: image.iso_639_1 }
        }));

        if (APP.cfg.fanart && type === "movie") {
          try {
            const fanartResponse = await fetch("https://webservice.fanart.tv/v3.2/movies/" + item.id + "?api_key=" + encodeURIComponent(APP.cfg.fanart));
            if (fanartResponse.ok) {
              const fanart = await fanartResponse.json();
              Object.entries(fanart).forEach(([kind, list]) => {
                if (!Array.isArray(list)) return;
                list.slice(0, 5).forEach(image => {
                  if (image?.url) artwork.push({ url: image.url, kind, source: "fanart.tv" });
                });
              });
            }
          } catch {}
        }

        return {
          overview: details.overview || "",
          meta: {
            Runtime: details.runtime ? details.runtime + " min" : "",
            Genres: (details.genres || []).map(item => item.name).join(", "),
            Status: details.status || "",
            Original: details.original_title || details.original_name || ""
          },
          artwork
        };
      }
    },
    wikidata: {
      label: "Wikidata",
      enabled: () => true,
      async search(query) {
        const url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" +
          encodeURIComponent(query) + "&language=ru&uselang=ru&type=item&limit=15&format=json&origin=*";
        const response = await fetch(url);
        if (!response.ok) throw new Error("Wikidata HTTP " + response.status);
        const data = await response.json();
        const likelyMedia = (data.search || []).filter(item => {
          const text = ((item.description || "") + " " + (item.label || "")).toLowerCase();
          return /film|movie|телесериал|сериал|television|tv series|animated|мультфильм|cinema/.test(text);
        });
        return (likelyMedia.length ? likelyMedia : (data.search || []).slice(0,8)).map(item => ({
          provider: "Wikidata",
          providerKey: "wikidata",
          id: item.id,
          title: item.label || item.id,
          originalTitle: item.label || item.id,
          year: "",
          type: "metadata",
          poster: "",
          overview: item.description || "",
          sourceUrl: "https://www.wikidata.org/wiki/" + item.id,
          raw: item
        }));
      },
      async details(item) {
        const url = "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" + encodeURIComponent(item.id) +
          "&props=claims|labels|descriptions&languages=ru|en&format=json&origin=*";
        const response = await fetch(url);
        if (!response.ok) throw new Error("Wikidata HTTP " + response.status);
        const data = await response.json();
        const entity = data.entities?.[item.id] || {};
        const claims = entity.claims || {};
        const claimValue = pid => claims[pid]?.[0]?.mainsnak?.datavalue?.value;
        const timeValue = pid => {
          const value = claimValue(pid);
          return value?.time ? String(value.time).replace(/^\+/,"").split("T")[0] : "";
        };
        const imdb = claimValue("P345") || "";
        const tmdbMovie = claimValue("P4947") || "";
        const tmdbTv = claimValue("P4983") || "";
        const official = claimValue("P856") || "";
        return {
          overview: entity.descriptions?.ru?.value || entity.descriptions?.en?.value || item.overview || "",
          meta: {
            Wikidata: item.id,
            IMDb: imdb,
            "TMDB Movie": tmdbMovie,
            "TMDB TV": tmdbTv,
            "Release date": timeValue("P577"),
            "Official website": official
          },
          artwork: []
        };
      }
    }
  };

  async function imageToDataUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Image HTTP " + response.status);
    const blob = await response.blob();
    return Studio.fileToDataUrl(new File([blob], "asset", { type: blob.type || "image/png" }));
  }

  async function addArtworkToProject(artwork, title) {
    status("Добавляю artwork...");
    try {
      let src = artwork.url;
      try { src = await imageToDataUrl(artwork.url); } catch {}
      const asset = await APP.addAsset({
        name: title + " · " + artwork.kind,
        src,
        source: artwork.source,
        kind: artwork.kind,
        meta: artwork.meta || {}
      });
      await Studio.addImageFromUrl(asset.src, asset.name, asset);
      APP.switchEditor("skooma");
      $("editorSelect").value = "skooma";
      status("Добавлено в Studio.", "ok");
    } catch (error) {
      status("Не удалось добавить изображение: " + error.message, "error");
    }
  }

  function renderResults(items) {
    const root = $("mediaResults");
    root.innerHTML = "";
    if (!items.length) {
      root.innerHTML = '<div class="empty-state">Ничего не найдено.</div>';
      return;
    }
    items.slice(0, 36).forEach(item => {
      const card = document.createElement("article");
      card.className = "media-card";
      const poster = item.poster
        ? '<img class="media-poster" src="' + item.poster + '" alt="">'
        : '<div class="media-poster"></div>';
      card.innerHTML = poster +
        '<div><div class="media-title">' + APP.escapeHtml(item.title) + '</div>' +
        '<div class="media-meta">' + APP.escapeHtml([item.originalTitle !== item.title ? item.originalTitle : "", item.year, item.type].filter(Boolean).join(" · ")) + '</div>' +
        '<div><span class="asset-provider-badge">' + APP.escapeHtml(item.provider) + '</span></div>' +
        '<div class="media-actions"><button class="secondary-button details-btn">Материалы</button>' +
        (item.poster ? '<button class="secondary-button poster-btn">Poster → Canvas</button>' : '') +
        (item.sourceUrl ? '<button class="secondary-button source-btn">Source</button>' : '') +
        '</div></div>';

      card.querySelector(".details-btn").onclick = event => {
        event.stopPropagation();
        loadDetails(item, card);
      };
      const posterButton = card.querySelector(".poster-btn");
      if (posterButton) {
        posterButton.onclick = async event => {
          event.stopPropagation();
          await addArtworkToProject({ url: item.poster, kind: "poster", source: item.provider }, item.title);
        };
      }
      const sourceButton = card.querySelector(".source-btn");
      if (sourceButton) sourceButton.onclick = event => {
        event.stopPropagation();
        window.open(item.sourceUrl, "_blank", "noopener");
      };
      root.appendChild(card);
    });
  }

  async function loadDetails(item, card) {
    const provider = providers[item.providerKey];
    if (!provider) return;
    status("Загружаю материалы...");
    try {
      const details = await provider.details(item);
      document.querySelectorAll(".media-detail-inline").forEach(node => node.remove());
      const block = document.createElement("div");
      block.className = "media-detail-inline";
      const meta = Object.entries(details.meta || {})
        .filter(([, value]) => value)
        .map(([key, value]) => '<div class="media-meta"><strong>' + APP.escapeHtml(key) + ':</strong> ' + APP.escapeHtml(value) + '</div>')
        .join("");
      block.innerHTML = '<div class="media-meta" style="margin-top:7px">' + APP.escapeHtml(details.overview || "") + '</div>' + meta;

      if (details.artwork?.length) {
        const grid = document.createElement("div");
        grid.className = "asset-grid";
        grid.style.marginTop = "8px";
        details.artwork.slice(0, 18).forEach(artwork => {
          const assetCard = document.createElement("div");
          assetCard.className = "asset-card";
          assetCard.innerHTML = '<img src="' + artwork.url + '" alt=""><div class="asset-info"><div class="asset-name">' +
            APP.escapeHtml(artwork.kind) + '</div><div class="asset-source">' + APP.escapeHtml(artwork.source) + '</div></div>';
          assetCard.ondblclick = () => addArtworkToProject(artwork, item.title);
          assetCard.title = "Двойной клик: добавить на canvas";
          grid.appendChild(assetCard);
        });
        block.appendChild(grid);
      }
      card.appendChild(block);
      status("Материалы загружены.", "ok");
    } catch (error) {
      status(error.message, "error");
    }
  }

  async function search() {
    const query = $("mediaQuery").value.trim();
    if (!query) return status("Введите название.", "error");

    const active = Object.values(providers).filter(provider => provider.enabled());
    status("Ищу: " + active.map(provider => provider.label).join(", ") + "...");

    const settled = await Promise.allSettled(active.map(provider => provider.search(query)));
    const items = [];
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") items.push(...result.value);
      else errors.push(active[index].label + ": " + result.reason?.message);
    });

    const seen = new Set();
    const deduped = items.filter(item => {
      const key = item.provider + ":" + item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    renderResults(deduped);
    if (errors.length) status("Найдено " + deduped.length + ". " + errors.join(" | "), "warn");
    else status("Найдено: " + deduped.length, "ok");
  }

  function refreshProviderState() {
    $("omdbProviderChip").classList.toggle("active", !!APP.cfg.omdb);
    $("tmdbProviderChip").classList.toggle("active", !!APP.cfg.tmdb);
    const enabled = ["TVmaze","Wikidata"];
    if (APP.cfg.omdb) enabled.push("OMDb");
    if (APP.cfg.tmdb) enabled.push("TMDB");
    status("Активные providers: " + enabled.join(", ") + ".");
  }

  $("mediaSearchBtn").onclick = search;
  $("mediaQuery").onkeydown = event => {
    if (event.key === "Enter") search();
  };
  refreshProviderState();

  return { search, refreshProviderState, providers };
})();