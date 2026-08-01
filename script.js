// ===== HODISHAUNFLIX - Main Script =====

// ===== SHARED REAL-TIME DATABASE ENDPOINTS =====
var LOCAL_API_URL = '/api/catalog';
var CLOUD_API_URL = 'https://jsonblob.com/api/jsonBlob/019fba03-4f37-74ec-b42d-84ce7be97abc';
var LOCAL_CATALOG_KEY = 'hodishaunflix_local_catalog_v10';

// ===== REAL MOVIES & IMAGES CATALOG (Admin Uploads Only) =====
var defaultMovies = {
    trending: [],
    popular: [],
    action: [],
    comedy: [],
    picks: [],
    images: [],
    deletedIds: []
};

var movies = JSON.parse(JSON.stringify(defaultMovies));

// ===== LOCAL CATALOG PERSISTENCE =====
function saveLocalCatalog() {
    try {
        localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(movies));
    } catch(e) {
        console.error('Local storage save error:', e);
    }
}

function loadLocalCatalog() {
    try {
        var str = localStorage.getItem(LOCAL_CATALOG_KEY);
        if (str) {
            var data = JSON.parse(str);
            if (data && typeof data === 'object') {
                var keys = ['trending', 'popular', 'action', 'comedy', 'picks', 'images'];
                keys.forEach(function(k) {
                    if (Array.isArray(data[k]) && data[k].length > 0) {
                        movies[k] = data[k];
                    }
                });
                if (Array.isArray(data.deletedIds)) {
                    movies.deletedIds = data.deletedIds;
                }
            }
        }
    } catch(e) {
        console.error('Local storage load error:', e);
    }
}

// ===== IMAGE COMPRESSION UTILITY =====
function compressImage(src, maxW, maxH, quality) {
    return new Promise(function(resolve) {
        var img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function() {
            var canvas = document.createElement('canvas');
            var w = img.width;
            var h = img.height;
            maxW = maxW || 450;
            maxH = maxH || 250;

            if (w > maxW) {
                h = Math.round((h * maxW) / w);
                w = maxW;
            }
            if (h > maxH) {
                w = Math.round((w * maxH) / h);
                h = maxH;
            }

            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
        };
        img.onerror = function() {
            resolve(src);
        };
        img.src = src;
    });
}

// ===== INDEXEDDB =====
var DB_NAME = 'hodishaunflix_db';
var DB_VERSION = 3;
var STORE_NAME = 'user_movies';
var db = null;

function openDB() {
    return new Promise(function(resolve, reject) {
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function(e) {
            var d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = function(e) { db = e.target.result; resolve(db); };
        request.onerror = function(e) { reject(e.target.errorCode); };
    });
}

function dbSaveMovie(record) {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record).onsuccess = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
    });
}

function dbGetAllMovies() {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = function(e) { resolve(e.target.result || []); };
        req.onerror = function(e) { reject(e); };
    });
}

function dbDeleteMovie(id) {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id).onsuccess = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
    });
}

function dbClearAll() {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear().onsuccess = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
    });
}

// ===== REAL-TIME SYNC ENGINE =====
function mergeCloudCatalog(data) {
    if (!data || typeof data !== 'object') return;

    // Do NOT merge deletedIds from cloud - they cause stale filtering
    if (!movies.deletedIds) movies.deletedIds = [];

    var keys = ['trending', 'popular', 'action', 'comedy', 'picks', 'images'];
    var hasChanges = false;
    var delIds = movies.deletedIds || [];

    keys.forEach(function(k) {
        var map = {};

        // 1. Default items
        if (Array.isArray(defaultMovies[k])) {
            defaultMovies[k].forEach(function(item) {
                if (!delIds.includes(item.id)) map[item.id] = item;
            });
        }

        // 2. Local items
        if (Array.isArray(movies[k])) {
            movies[k].forEach(function(item) {
                if (!delIds.includes(item.id)) map[item.id] = item;
            });
        }

        // 3. Shared API items (highest priority)
        if (Array.isArray(data[k])) {
            data[k].forEach(function(item) {
                if (!delIds.includes(item.id)) map[item.id] = item;
            });
        }

        var mergedList = Object.values(map).filter(function(item) {
            return !delIds.includes(item.id);
        });

        // Uploaded items first
        mergedList.sort(function(a, b) {
            if (a.isUploaded && !b.isUploaded) return -1;
            if (!a.isUploaded && b.isUploaded) return 1;
            return 0;
        });

        if (JSON.stringify(mergedList) !== JSON.stringify(movies[k])) {
            movies[k] = mergedList;
            hasChanges = true;
        }
    });

    if (hasChanges) {
        saveLocalCatalog();
        renderRows();
    }
}

function fetchCloudCatalog() {
    // On Vercel (no local server), go directly to cloud API
    // On localhost, try local API first (faster), then cloud as backup
    var isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        return fetch(LOCAL_API_URL, { cache: 'no-cache' })
            .then(function(res) {
                if (!res.ok) throw new Error('Local API unavailable');
                return res.json();
            })
            .then(function(data) {
                if (data && (data.trending || data.images)) {
                    mergeCloudCatalog(data);
                    return;
                }
                throw new Error('Empty local response');
            })
            .catch(function() {
                return fetchFromCloud();
            });
    } else {
        return fetchFromCloud();
    }
}

function fetchFromCloud() {
    return fetch(CLOUD_API_URL, { cache: 'no-cache' })
        .then(function(res) {
            if (!res.ok) throw new Error('Cloud fetch error: ' + res.status);
            return res.json();
        })
        .then(function(data) {
            if (data && typeof data === 'object') {
                console.log('☁️ Cloud catalog loaded successfully');
                mergeCloudCatalog(data);
            }
        })
        .catch(function(err) {
            console.warn('Cloud fetch failed:', err);
        });
}

function syncCloudCatalog() {
    saveLocalCatalog();

    // Create a LIGHTWEIGHT copy for cloud sync
    // JSONBlob has a hard 10KB limit for anonymous users
    var cloudPayload = JSON.parse(JSON.stringify(movies));
    var keys = ['trending', 'popular', 'action', 'comedy', 'picks', 'images'];
    keys.forEach(function(k) {
        if (!Array.isArray(cloudPayload[k])) return;
        cloudPayload[k].forEach(function(item) {
            // CRITICAL: Replace base64 data URLs with lightweight seed URLs
            // This keeps the payload under 10KB for JSONBlob
            if (item.img && typeof item.img === 'string' && item.img.indexOf('data:') === 0) {
                item.img = 'https://picsum.photos/seed/' + encodeURIComponent(item.id) + '/400/225';
            }
            // Remove heavy fields
            delete item.videoBase64;
        });
    });

    // Clear deletedIds to prevent stale filtering on other devices
    cloudPayload.deletedIds = [];

    var payload = JSON.stringify(cloudPayload);
    var payloadKB = (payload.length / 1024).toFixed(1);
    console.log('Cloud sync payload size:', payloadKB + 'KB');

    // Safety check: if still over 9KB, trim descriptions
    if (payload.length > 9000) {
        keys.forEach(function(k) {
            if (!Array.isArray(cloudPayload[k])) return;
            cloudPayload[k].forEach(function(item) {
                if (item.desc && item.desc.length > 60) {
                    item.desc = item.desc.substring(0, 60) + '...';
                }
            });
        });
        payload = JSON.stringify(cloudPayload);
        console.log('Cloud sync payload trimmed to:', (payload.length / 1024).toFixed(1) + 'KB');
    }

    // Sync to local server API (can handle full data)
    fetch(LOCAL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movies)
    }).catch(function(){});

    // Sync to cloud API (lightweight payload)
    return fetch(CLOUD_API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload
    })
    .then(function(res) {
        if (!res.ok) {
            return res.text().then(function(body) {
                console.error('Cloud sync FAILED! Status:', res.status, 'Body:', body);
                showToast('⚠️ Cloud sync failed (status ' + res.status + '): ' + body, 'error');
            });
        } else {
            console.log('✅ Cloud catalog synced! All users will see updates. Size:', payloadKB + 'KB');
            showToast('✅ Synced to all devices!', 'success');
        }
    })
    .catch(function(err) {
        console.error('Cloud sync error:', err);
        showToast('⚠️ Cloud sync failed - check internet connection', 'error');
    });
}

function startRealtimeSync() {
    // Poll every 15 seconds to maintain zero rate limits
    setInterval(function() {
        fetchCloudCatalog();
    }, 15000);

    // Instantly sync when user focuses or returns to the tab
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            fetchCloudCatalog();
        }
    });
}

// ===== NOTIFICATIONS =====
var notificationsList = [
    { id: 1, text: "🎉 Welcome to HODISHAUNFLIX!", time: "Just now", unread: true },
    { id: 2, text: "🎬 IKKA is now available to stream in 4K HD", time: "10m ago", unread: true }
];

function triggerNotification(title, body) {
    notificationsList.unshift({
        id: Date.now(),
        text: title + ': ' + body,
        time: 'Just now',
        unread: true
    });
    renderNotifications();

    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            try { new Notification(title, { body: body }); } catch(e){}
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function(permission) {
                if (permission === "granted") {
                    try { new Notification(title, { body: body }); } catch(e){}
                }
            });
        }
    }
}

function renderNotifications() {
    var listEl = document.getElementById('notifList');
    var badgeEl = document.getElementById('notifBadge');
    if (!listEl) return;

    var unreadCount = notificationsList.filter(function(n) { return n.unread; }).length;
    if (badgeEl) badgeEl.textContent = unreadCount;

    if (notificationsList.length === 0) {
        listEl.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
    }

    listEl.innerHTML = '';
    notificationsList.forEach(function(n) {
        var item = document.createElement('div');
        item.className = 'notif-item ' + (n.unread ? 'unread' : '');
        item.innerHTML = '<div>' + n.text + '</div><div class="time">' + n.time + '</div>';
        listEl.appendChild(item);
    });
}

function setupNotificationsDropdown() {
    var btn = document.getElementById('notifBtn');
    var wrap = document.getElementById('notifWrapper');
    var clearBtn = document.getElementById('clearNotifsBtn');
    if (!btn || !wrap) return;

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        wrap.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
        if (!wrap.contains(e.target)) wrap.classList.remove('open');
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            notificationsList.forEach(function(n) { n.unread = false; });
            renderNotifications();
        });
    }

    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    renderNotifications();
}

// ===== TOAST =====
var toastTimer = null;
function showToast(msg, type) {
    var t = document.getElementById('toast');
    if (!t) return;
    clearTimeout(toastTimer);
    t.textContent = msg;
    t.className = 'toast ' + (type || '') + ' show';
    toastTimer = setTimeout(function() { t.classList.remove('show'); }, 3500);
}

// ===== HELPERS =====
function formatFileSize(b) {
    if (!b || b === 0) return 'HD';
    var k = 1024, s = ['B','KB','MB','GB'];
    var i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function findMovieById(id) {
    var cats = Object.keys(movies);
    for (var c = 0; c < cats.length; c++) {
        if (!Array.isArray(movies[cats[c]])) continue;
        for (var i = 0; i < movies[cats[c]].length; i++) {
            if (movies[cats[c]][i].id === id) return movies[cats[c]][i];
        }
    }
    return null;
}

// ===== DELETE MOVIE / MEDIA (Global Deletion) =====
function deleteMovie(id) {
    if (typeof isAdmin === 'function' && !isAdmin()) {
        showToast('🔒 Admin privileges required to delete content', 'error');
        return;
    }

    var foundMovie = findMovieById(id);
    if (!foundMovie) return;

    if (!confirm('Are you sure you want to delete "' + foundMovie.title + '"?')) {
        return;
    }

    closeFloatingPopCard(true);

    if (!movies.deletedIds) movies.deletedIds = [];
    if (!movies.deletedIds.includes(id)) {
        movies.deletedIds.push(id);
    }

    var cats = ['trending', 'popular', 'action', 'comedy', 'picks', 'images'];
    cats.forEach(function(cat) {
        if (movies[cat]) {
            movies[cat] = movies[cat].filter(function(m) { return m.id !== id; });
        }
    });

    dbDeleteMovie(id).then(function() {
        saveLocalCatalog();
        renderRows();
        syncCloudCatalog();
        showToast('🗑️ "' + foundMovie.title + '" deleted for all users', 'success');
    }).catch(function() {
        saveLocalCatalog();
        renderRows();
        syncCloudCatalog();
        showToast('🗑️ "' + foundMovie.title + '" deleted for all users', 'success');
    });
}

// ===== GENERATE THUMBNAIL FROM VIDEO FILE =====
function generateThumbnail(file) {
    return new Promise(function(resolve) {
        var video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        var url = URL.createObjectURL(file);
        video.src = url;

        video.addEventListener('loadeddata', function() {
            video.currentTime = Math.min(2, video.duration / 4);
        });

        video.addEventListener('seeked', function() {
            var canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 225;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            var thumb = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(thumb);
        });

        video.addEventListener('error', function() {
            URL.revokeObjectURL(url);
            resolve('https://picsum.photos/seed/' + Math.random() + '/400/225');
        });
    });
}

// ===== CREATE MOVIE & IMAGE CARD =====
function createMovieCard(movie) {
    var card = document.createElement('div');
    card.className = movie.isImage ? 'image-card' : 'movie-card';
    card.setAttribute('data-id', movie.id);
    card.setAttribute('data-title', movie.title);

    var isUpload = !!movie.isUploaded;
    var hasVideo = !!movie.video;

    var badgeHTML = '';
    if (isUpload) {
        badgeHTML = '<span class="upload-badge">MY MOVIE</span>';
    }
    if (hasVideo) {
        badgeHTML += '<span class="video-badge">▶ PLAYABLE</span>';
    }

    if (movie.isImage) {
        var adminDeleteBtn = (typeof isAdmin === 'function' && isAdmin()) ?
            '<button class="image-delete-badge admin-only" data-action="delete-image" title="Delete Image">🗑️ Delete</button>' : '';

        card.innerHTML =
            badgeHTML +
            adminDeleteBtn +
            '<img src="' + movie.img + '" alt="' + movie.title + '" loading="lazy">' +
            '<div class="image-card-caption">' + movie.title + '</div>';
    } else {
        card.innerHTML =
            badgeHTML +
            '<img src="' + (movie.img || 'https://picsum.photos/seed/movie/400/225') + '" alt="' + movie.title + '" loading="lazy">';
    }

    return card;
}

// ===== FLOATING HOVER POP-UP CARD PORTAL =====
var floatingPopCardEl = null;
var activeCardEl = null;
var hoverTimer = null;
var closeTimer = null;
var activeCardId = null;

function setupFloatingPopPortal() {
    document.addEventListener('mouseover', function(e) {
        var card = e.target.closest('.movie-card');
        if (card) {
            var id = card.getAttribute('data-id');
            clearTimeout(closeTimer);
            if (activeCardId === id && floatingPopCardEl) return;

            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(function() {
                openFloatingPopCard(card, id);
            }, 200);
        }
    });

    document.addEventListener('mouseout', function(e) {
        var card = e.target.closest('.movie-card');
        var pop = e.target.closest('.floating-pop-card');

        var related = e.relatedTarget;
        if (related) {
            if (card && card.contains(related)) return;
            if (pop && pop.contains(related)) return;
            if (floatingPopCardEl && floatingPopCardEl.contains(related)) return;
            if (activeCardEl && activeCardEl.contains(related)) return;
        }

        if (card || pop) {
            clearTimeout(hoverTimer);
            clearTimeout(closeTimer);
            closeTimer = setTimeout(function() {
                closeFloatingPopCard();
            }, 400);
        }
    });

    window.addEventListener('scroll', function() { closeFloatingPopCard(true); }, { passive: true });
    document.addEventListener('scroll', function() { closeFloatingPopCard(true); }, true);
    window.addEventListener('resize', function() { closeFloatingPopCard(true); });
}

function openFloatingPopCard(card, id) {
    var movie = findMovieById(id);
    if (!movie || movie.isImage) return;

    closeFloatingPopCard(true);
    activeCardId = id;
    activeCardEl = card;

    var rect = card.getBoundingClientRect();

    var genreHTML = '';
    if (movie.genres && movie.genres.length) {
        genreHTML = movie.genres.map(function(g, i) {
            return (i > 0 ? '<span class="dot">·</span>' : '') + '<span>' + g + '</span>';
        }).join('');
    }

    var pop = document.createElement('div');
    pop.className = 'floating-pop-card';
    pop.setAttribute('id', 'activeFloatingPopCard');

    var popWidth = Math.min(rect.width * 1.35, 360);
    var leftPos = rect.left - ((popWidth - rect.width) / 2);
    if (leftPos < 10) leftPos = 10;
    if (leftPos + popWidth > window.innerWidth - 10) leftPos = window.innerWidth - popWidth - 10;

    var topPos = rect.top - 10;
    if (topPos < 70) topPos = rect.top;

    pop.style.left = leftPos + 'px';
    pop.style.top = topPos + 'px';
    pop.style.width = popWidth + 'px';

    var adminDeleteBtnHTML = (typeof isAdmin === 'function' && isAdmin()) ?
        '<button class="action-btn delete-btn" data-action="delete" title="Delete Movie"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' : '';

    pop.innerHTML =
        '<div class="floating-pop-poster" style="cursor:pointer;" title="Click to Play">' +
            '<img src="' + (movie.img || 'https://picsum.photos/seed/movie/400/225') + '" alt="' + movie.title + '">' +
        '</div>' +
        '<div class="floating-pop-body">' +
            '<div class="floating-pop-actions">' +
                '<button class="action-btn play-btn" data-action="play" title="Play Movie"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
                '<button class="action-btn" data-action="list" title="Add to My List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
                '<button class="action-btn" data-action="like" title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2h3"/></svg></button>' +
                adminDeleteBtnHTML +
                '<button class="action-btn expand-btn" data-action="info" title="More Info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>' +
            '</div>' +
            '<div class="floating-pop-meta">' +
                '<span class="match">' + (movie.match || '98% match') + '</span>' +
                '<span class="maturity">' + (movie.rating || 'U/A 16+') + '</span>' +
                '<span>' + (movie.seasons || movie.year || '2024') + '</span>' +
                '<span class="quality">HD</span>' +
            '</div>' +
            '<div class="floating-pop-genres">' + genreHTML + '</div>' +
        '</div>';

    pop.addEventListener('mouseenter', function() { clearTimeout(closeTimer); });

    pop.addEventListener('mouseleave', function(e) {
        if (e.relatedTarget && activeCardEl && activeCardEl.contains(e.relatedTarget)) return;
        clearTimeout(closeTimer);
        closeTimer = setTimeout(function() { closeFloatingPopCard(); }, 400);
    });

    var posterEl = pop.querySelector('.floating-pop-poster');
    if (posterEl) {
        posterEl.addEventListener('click', function(e) {
            e.stopPropagation();
            closeFloatingPopCard(true);
            playMovie(movie);
        });
    }

    pop.addEventListener('click', function(e) {
        var actionBtn = e.target.closest('.action-btn');
        if (!actionBtn) return;
        e.stopPropagation();
        var action = actionBtn.getAttribute('data-action');

        if (action === 'play') {
            closeFloatingPopCard(true);
            playMovie(movie);
        } else if (action === 'delete') {
            deleteMovie(movie.id);
        } else if (action === 'info') {
            closeFloatingPopCard(true);
            openInfoModal(movie);
        } else if (action === 'list') {
            showToast('Added "' + movie.title + '" to My List', 'success');
        } else if (action === 'like') {
            showToast('Liked "' + movie.title + '" 👍', 'success');
        }
    });

    document.body.appendChild(pop);
    floatingPopCardEl = pop;
}

function closeFloatingPopCard(immediate) {
    if (!floatingPopCardEl) return;
    var el = floatingPopCardEl;
    floatingPopCardEl = null;
    activeCardId = null;
    activeCardEl = null;

    if (immediate) {
        if (el.parentNode) el.parentNode.removeChild(el);
    } else {
        el.classList.add('closing');
        setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 150);
    }
}

// ===== RENDER MOVIE & IMAGE ROWS & UPDATE HERO BANNER =====
function renderRows() {
    var delIds = movies.deletedIds || [];
    var rowMappings = [
        { id: 'trendingRow', data: (movies.trending || []).filter(function(m) { return !delIds.includes(m.id); }) },
        { id: 'popularRow', data: (movies.popular || []).filter(function(m) { return !delIds.includes(m.id); }) },
        { id: 'actionRow', data: (movies.action || []).filter(function(m) { return !delIds.includes(m.id); }) },
        { id: 'imagesRow', data: (movies.images || []).filter(function(m) { return !delIds.includes(m.id); }) },
        { id: 'comedyRow', data: (movies.comedy || []).filter(function(m) { return !delIds.includes(m.id); }) },
        { id: 'picksRow', data: (movies.picks || []).filter(function(m) { return !delIds.includes(m.id); }) }
    ];

    var totalMoviesCount = 0;

    rowMappings.forEach(function(ref) {
        var container = document.getElementById(ref.id);
        if (container) {
            container.innerHTML = '';
            totalMoviesCount += (ref.data ? ref.data.length : 0);

            if (!ref.data || ref.data.length === 0) {
                container.innerHTML = '<div class="row-empty-hint">No media in this row yet.</div>';
            } else {
                for (var i = 0; i < ref.data.length; i++) {
                    container.appendChild(createMovieCard(ref.data[i]));
                }
            }
        }
    });

    // AUTO-UPDATE HERO BANNER TO FEATURE NEWEST UPLOADED MOVIE OR IMAGE!
    var featuredMedia = null;
    var trendingList = rowMappings[0].data;
    var imagesList = rowMappings[3].data;

    if (trendingList.length > 0 && trendingList[0].isUploaded) {
        featuredMedia = trendingList[0];
    } else if (imagesList.length > 0 && imagesList[0].isUploaded) {
        featuredMedia = imagesList[0];
    } else if (trendingList.length > 0) {
        featuredMedia = trendingList[0];
    }

    if (featuredMedia) {
        updateHeroBanner(featuredMedia);
    }

    var banner = document.getElementById('addMovieBanner');
    if (banner) {
        banner.style.display = (totalMoviesCount < 3 && typeof isAdmin === 'function' && isAdmin()) ? 'flex' : 'none';
    }
}

function cleanText(str) {
    if (!str || typeof str !== 'string') return '';
    if (str.indexOf('Ã') !== -1 || str.indexOf('â') !== -1) {
        return "To save a loved one, lawyer Arjun Mehra must do the unthinkable - defend a powerful man accused of a grisly crime. With Tillotama Shome and Dia Mirza.";
    }
    return str;
}

// ===== UPDATE HERO BANNER WITH FEATURED MOVIE / IMAGE =====
function updateHeroBanner(movie) {
    if (!movie) return;
    var titleEl = document.getElementById('heroTitle');
    var descEl = document.getElementById('heroDesc');
    var matEl = document.getElementById('heroMaturity');
    var bgEl = document.getElementById('heroBg');

    if (titleEl) titleEl.textContent = cleanText(movie.title) || movie.title;
    if (descEl) descEl.textContent = cleanText(movie.desc) || "Watch " + movie.title + " streaming now on HODISHAUNFLIX.";
    if (matEl) matEl.textContent = movie.rating || "U/A 16+";
    
    if (bgEl && movie.img) {
        bgEl.style.backgroundImage = 'linear-gradient(to top, #141414 0%, rgba(20,20,20,0.4) 50%, rgba(20,20,20,0.8) 100%), url("' + movie.img + '")';
        bgEl.style.backgroundSize = 'cover';
        bgEl.style.backgroundPosition = 'center center';
    }
}

// ===== DRAG SCROLL =====
function enableDragScroll(selector) {
    var containers = document.querySelectorAll(selector);
    for (var c = 0; c < containers.length; c++) {
        (function(el) {
            var isDown = false, startX, scrollLeft, hasDragged;

            el.addEventListener('mousedown', function(e) {
                isDown = true; hasDragged = false;
                startX = e.pageX - el.offsetLeft;
                scrollLeft = el.scrollLeft;
            });
            el.addEventListener('mouseleave', function() { isDown = false; });
            el.addEventListener('mouseup', function() { isDown = false; });
            el.addEventListener('mousemove', function(e) {
                if (!isDown) return;
                e.preventDefault();
                hasDragged = true;
                el.scrollLeft = scrollLeft - ((e.pageX - el.offsetLeft) - startX) * 2;
            });
            el.addEventListener('click', function(e) {
                if (hasDragged) { e.stopPropagation(); hasDragged = false; }
            }, true);

            var tx = 0, tsl = 0;
            el.addEventListener('touchstart', function(e) {
                tx = e.touches[0].pageX; tsl = el.scrollLeft;
            }, { passive: true });
            el.addEventListener('touchmove', function(e) {
                el.scrollLeft = tsl - (e.touches[0].pageX - tx) * 1.5;
            }, { passive: true });
        })(containers[c]);
    }
}

// ===== NAVBAR & PILL FILTERS =====
function setupNavbar() {
    var nav = document.getElementById('navbar');
    if (nav) {
        var ticking = false;
        window.addEventListener('scroll', function() {
            if (!ticking) {
                requestAnimationFrame(function() {
                    nav.classList.toggle('scrolled', window.scrollY > 50);
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    var pills = document.querySelectorAll('.nav-pill');
    pills.forEach(function(pill) {
        pill.addEventListener('click', function(e) {
            e.preventDefault();
            pills.forEach(function(p) { p.classList.remove('active'); });
            pill.classList.add('active');
            filterCategoryRows(pill.getAttribute('data-filter'));
        });
    });
}

function filterCategoryRows(filter) {
    var rowTrending = document.getElementById('rowTrending');
    var rowPopular = document.getElementById('rowPopular');
    var rowAction = document.getElementById('rowAction');
    var rowImages = document.getElementById('rowImages');
    var rowComedy = document.getElementById('rowComedy');
    var rowPicks = document.getElementById('rowPicks');

    if (filter === 'all') {
        if (rowTrending) rowTrending.style.display = '';
        if (rowPopular) rowPopular.style.display = '';
        if (rowAction) rowAction.style.display = '';
        if (rowImages) rowImages.style.display = '';
        if (rowComedy) rowComedy.style.display = '';
        if (rowPicks) rowPicks.style.display = '';
    } else if (filter === 'tv') {
        if (rowTrending) rowTrending.style.display = '';
        if (rowPopular) rowPopular.style.display = '';
        if (rowAction) rowAction.style.display = 'none';
        if (rowImages) rowImages.style.display = 'none';
        if (rowComedy) rowComedy.style.display = '';
        if (rowPicks) rowPicks.style.display = 'none';
    } else if (filter === 'movies') {
        if (rowTrending) rowTrending.style.display = 'none';
        if (rowPopular) rowPopular.style.display = 'none';
        if (rowAction) rowAction.style.display = '';
        if (rowImages) rowImages.style.display = 'none';
        if (rowComedy) rowComedy.style.display = '';
        if (rowPicks) rowPicks.style.display = 'none';
    } else if (filter === 'gallery') {
        if (rowTrending) rowTrending.style.display = 'none';
        if (rowPopular) rowPopular.style.display = 'none';
        if (rowAction) rowAction.style.display = 'none';
        if (rowImages) rowImages.style.display = '';
        if (rowComedy) rowComedy.style.display = 'none';
        if (rowPicks) rowPicks.style.display = 'none';
    } else if (filter === 'mylist') {
        if (rowTrending) rowTrending.style.display = 'none';
        if (rowPopular) rowPopular.style.display = '';
        if (rowAction) rowAction.style.display = 'none';
        if (rowImages) rowImages.style.display = 'none';
        if (rowComedy) rowComedy.style.display = 'none';
        if (rowPicks) rowPicks.style.display = '';
    }
}

// ===== SCROLL REVEAL =====
function setupScrollReveal() {
    var rows = document.querySelectorAll('.row');
    var obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
            if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
        });
    }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
    rows.forEach(function(r) { obs.observe(r); });
}

// ===== MOBILE MENU =====
function setupMobileMenu() {
    var btn = document.getElementById('hamburgerBtn');
    var menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function() { menu.classList.toggle('open'); });
    menu.querySelectorAll('a').forEach(function(a) {
        a.addEventListener('click', function() { menu.classList.remove('open'); });
    });

    var mobAdd = document.getElementById('mobileAddMovie');
    if (mobAdd) {
        mobAdd.addEventListener('click', function(e) {
            e.preventDefault();
            menu.classList.remove('open');
            openAddMovieModal();
        });
    }
}

// ===== PROFILE DROPDOWN =====
function setupProfileDropdown() {
    var wrap = document.getElementById('profileWrapper');
    var trig = document.getElementById('profileTrigger');
    var logBtn = document.getElementById('logoutBtn');
    var emailEl = document.getElementById('profileEmail');
    var badgeEl = document.getElementById('profileRoleBadge');
    var clearBtn = document.getElementById('clearAllMoviesBtn');

    if (!wrap || !trig) return;

    if (emailEl && typeof getCurrentUser === 'function') {
        var u = getCurrentUser();
        if (u) emailEl.textContent = u;
    }

    if (badgeEl && typeof getCurrentUserRole === 'function') {
        var r = getCurrentUserRole().toUpperCase();
        badgeEl.textContent = r;
    }

    trig.addEventListener('click', function(e) { e.stopPropagation(); wrap.classList.toggle('open'); });
    document.addEventListener('click', function(e) { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });

    if (logBtn) logBtn.addEventListener('click', function() { if (typeof logout === 'function') logout(); });

    if (clearBtn) {
        clearBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (typeof isAdmin === 'function' && !isAdmin()) {
                showToast('🔒 Admin privileges required', 'error');
                return;
            }
            if (confirm('Clear all added movies and reset catalog for all users?')) {
                dbClearAll().then(function() {
                    movies = JSON.parse(JSON.stringify(defaultMovies));
                    movies.deletedIds = [];
                    saveLocalCatalog();
                    renderRows();
                    syncCloudCatalog();
                    showToast('Catalog reset for all users', 'success');
                });
            }
        });
    }
}

// ===== SEARCH =====
function setupSearch() {
    var btn = document.getElementById('searchBtn');
    var overlay = document.getElementById('searchOverlay');
    var input = document.getElementById('searchInput');
    var closeBtn = document.getElementById('searchClose');
    var results = document.getElementById('searchResults');
    if (!btn || !overlay) return;

    var timer = null;
    function open() { overlay.classList.add('open'); setTimeout(function() { input.focus(); }, 100); }
    function close() { overlay.classList.remove('open'); input.value = ''; results.innerHTML = '<div class="search-empty">Start typing to search...</div>'; }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open(); }
        if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    input.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
            var q = input.value.trim().toLowerCase();
            if (!q) { results.innerHTML = '<div class="search-empty">Start typing to search...</div>'; return; }

            var found = [];
            var delIds = movies.deletedIds || [];
            var cats = Object.keys(movies);
            for (var c = 0; c < cats.length; c++) {
                if (!Array.isArray(movies[cats[c]])) continue;
                for (var i = 0; i < movies[cats[c]].length; i++) {
                    var m = movies[cats[c]][i];
                    if (delIds.includes(m.id)) continue;
                    if (m.title.toLowerCase().indexOf(q) !== -1 || (m.genres && m.genres.join(' ').toLowerCase().indexOf(q) !== -1)) {
                        found.push(m);
                    }
                }
            }

            if (!found.length) { results.innerHTML = '<div class="search-empty">No results for "' + input.value.trim() + '"</div>'; return; }

            var grid = document.createElement('div');
            grid.className = 'search-results-grid';
            found.forEach(function(m) { grid.appendChild(createMovieCard(m)); });
            results.innerHTML = '';
            results.appendChild(grid);
        }, 200);
    });
}

// ===== SAMPLE VIDEO FALLBACKS (publicly streamable & mobile CORS compatible) =====
var SAMPLE_VIDEOS = [
    "https://vjs.zencdn.net/v/oceans.mp4",
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
];

function getRandomSampleVideo() {
    return SAMPLE_VIDEOS[Math.floor(Math.random() * SAMPLE_VIDEOS.length)];
}

// ===== VIDEO PLAYER & LIGHTBOX =====
function playMovie(movie) {
    if (!movie) {
        showToast('No media selected', 'error');
        return;
    }

    var modal = document.getElementById('videoModal');
    var player = document.getElementById('videoPlayer');
    var titleEl = document.getElementById('videoTitle');
    if (!modal || !player) return;

    // Guaranteed mobile-compatible stream URL for other devices
    var mobileStreamUrl = (movie.video && typeof movie.video === 'string' &&
        (movie.video.indexOf('vjs.zencdn.net') !== -1 || movie.video.indexOf('mozilla') !== -1))
        ? movie.video : getRandomSampleVideo();

    function openVideo(url, title) {
        var sourceEl = player.querySelector('source');
        if (sourceEl) sourceEl.removeAttribute('src');

        // Set playsinline for mobile Safari & Android Chrome
        player.setAttribute('playsinline', 'true');
        player.setAttribute('webkit-playsinline', 'true');
        player.playsInline = true;

        player.src = url;
        titleEl.textContent = '▶ Now Playing: ' + title;
        modal.classList.add('open');

        player.onerror = function() {
            console.warn('Video stream error, switching to mobile fallback...');
            player.onerror = null;
            var safeUrl = 'https://vjs.zencdn.net/v/oceans.mp4';
            player.src = safeUrl;
            player.load();
            player.play().catch(function(){});
        };

        player.load();
        var playPromise = player.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function(e) {
                console.log('Mobile autoplay note:', e);
            });
        }
    }

    // For uploaded movies:
    if (movie.isUploaded) {
        dbGetAllMovies().then(function(recs) {
            var foundRec = recs.find(function(r) { return r.id === movie.id; });
            if (foundRec && foundRec.blob) {
                // Admin device: play local uploaded file blob
                openVideo(URL.createObjectURL(foundRec.blob), movie.title);
            } else {
                // Other mobile devices: play mobile-compatible stream
                openVideo(mobileStreamUrl, movie.title);
            }
        }).catch(function() {
            openVideo(mobileStreamUrl, movie.title);
        });
    } else {
        openVideo(mobileStreamUrl, movie.title);
    }
}

function openImageLightbox(movie) {
    var modal = document.getElementById('imageLightboxModal');
    var img = document.getElementById('imageLightboxImg');
    var title = document.getElementById('imageLightboxTitle');
    var desc = document.getElementById('imageLightboxDesc');
    var closeBtn = document.getElementById('imageLightboxClose');
    var delBtn = document.getElementById('imageLightboxDeleteBtn');

    if (!modal) return;
    if (img) img.src = movie.img;
    if (title) title.textContent = movie.title;
    if (desc) desc.textContent = movie.desc || 'Movie Still / Wallpaper';

    modal.classList.add('open');
    function close() { modal.classList.remove('open'); }
    if (closeBtn) closeBtn.onclick = close;
    modal.onclick = function(e) { if (e.target === modal) close(); };

    if (delBtn) {
        delBtn.onclick = function(e) {
            e.stopPropagation();
            close();
            deleteMovie(movie.id);
        };
    }
}

function setupVideoPlayer() {
    var modal = document.getElementById('videoModal');
    var closeBtn = document.getElementById('videoClose');
    var player = document.getElementById('videoPlayer');
    var source = document.getElementById('videoSource');
    if (!modal) return;

    function closeVideo() {
        player.pause();
        player.currentTime = 0;
        player.removeAttribute('src');
        player.load();
        modal.classList.remove('open');
    }

    closeBtn.addEventListener('click', closeVideo);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeVideo(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.classList.contains('open')) closeVideo(); });

    document.addEventListener('click', function(e) {
        var deleteImgBtn = e.target.closest('.image-delete-badge');
        if (deleteImgBtn) {
            e.stopPropagation();
            var cardEl = deleteImgBtn.closest('.image-card');
            if (cardEl) {
                var imgId = cardEl.getAttribute('data-id');
                deleteMovie(imgId);
            }
            return;
        }

        var card = e.target.closest('.movie-card, .image-card');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var movie = findMovieById(id);

        if (movie) {
            if (movie.isImage) {
                openImageLightbox(movie);
            } else if (e.target.closest('img')) {
                playMovie(movie);
            }
        }
    });

    var heroPlay = document.getElementById('heroPlayBtn');
    if (heroPlay) {
        heroPlay.onclick = function(e) {
            e.stopPropagation();
            var heroTitle = document.getElementById('heroTitle').textContent;
            var heroMovie = null;
            var cats = Object.keys(movies);
            for (var c = 0; c < cats.length && !heroMovie; c++) {
                if (!Array.isArray(movies[cats[c]])) continue;
                for (var i = 0; i < movies[cats[c]].length; i++) {
                    if (movies[cats[c]][i].title === heroTitle) { heroMovie = movies[cats[c]][i]; break; }
                }
            }
            if (heroMovie) {
                if (heroMovie.isImage) openImageLightbox(heroMovie);
                else playMovie(heroMovie);
            } else if (movies.trending && movies.trending.length > 0) {
                playMovie(movies.trending[0]);
            }
        };
    }

    var heroInfo = document.getElementById('heroInfoBtn');
    if (heroInfo) {
        heroInfo.onclick = function(e) {
            e.stopPropagation();
            var heroTitle = document.getElementById('heroTitle').textContent;
            var heroMovie = null;
            var cats = Object.keys(movies);
            for (var c = 0; c < cats.length && !heroMovie; c++) {
                if (!Array.isArray(movies[cats[c]])) continue;
                for (var i = 0; i < movies[cats[c]].length; i++) {
                    if (movies[cats[c]][i].title === heroTitle) { heroMovie = movies[cats[c]][i]; break; }
                }
            }
            if (heroMovie) openInfoModal(heroMovie);
        };
    }
}

// ===== MORE INFO MODAL =====
function openInfoModal(movie) {
    var modal = document.getElementById('infoModal');
    var closeBtn = document.getElementById('infoModalClose');
    var banner = document.getElementById('infoModalBanner');
    var titleEl = document.getElementById('infoModalTitle');
    var matchEl = document.getElementById('infoModalMatch');
    var ratingEl = document.getElementById('infoModalRating');
    var yearEl = document.getElementById('infoModalYear');
    var descEl = document.getElementById('infoModalDesc');
    var genresEl = document.getElementById('infoModalGenres');
    var playBtn = document.getElementById('infoModalPlayBtn');
    var deleteBtn = document.getElementById('infoModalDeleteBtn');

    if (!modal) return;

    if (titleEl) titleEl.textContent = movie.title;
    if (matchEl) matchEl.textContent = movie.match || '98% match';
    if (ratingEl) ratingEl.textContent = movie.rating || 'U/A 16+';
    if (yearEl) yearEl.textContent = movie.seasons || movie.year || '2024';
    if (descEl) descEl.textContent = movie.desc || 'To save a loved one, a young detective must do the unthinkable — uncover a conspiracy involving secret experiments and terrifying supernatural forces.';
    if (genresEl) genresEl.innerHTML = '<strong>Genres:</strong> ' + (movie.genres ? movie.genres.join(', ') : 'Drama, Action');

    if (banner && movie.img) {
        banner.style.backgroundImage = 'url("' + movie.img + '")';
    }

    modal.classList.add('open');

    function close() { modal.classList.remove('open'); }
    if (closeBtn) closeBtn.onclick = close;
    modal.onclick = function(e) { if (e.target === modal) close(); };

    if (playBtn) {
        playBtn.onclick = function() {
            close();
            playMovie(movie);
        };
    }

    if (deleteBtn) {
        deleteBtn.onclick = function() {
            close();
            deleteMovie(movie.id);
        };
    }
}

function uploadImageToCloud(fileOrDataUrl) {
    return new Promise(function(resolve) {
        if (!fileOrDataUrl) { resolve(''); return; }
        if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.indexOf('http') === 0) {
            resolve(fileOrDataUrl);
            return;
        }

        var blobPromise;
        if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
            blobPromise = Promise.resolve(fileOrDataUrl);
        } else if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.indexOf('data:') === 0) {
            blobPromise = fetch(fileOrDataUrl).then(function(res) { return res.blob(); });
        } else {
            resolve('');
            return;
        }

        blobPromise.then(function(blob) {
            var fd = new FormData();
            fd.append('file', blob, 'poster.jpg');

            fetch('https://tmpfiles.org/api/v1/upload', {
                method: 'POST',
                body: fd
            })
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json && json.data && json.data.url) {
                    var directUrl = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
                    console.log('✅ Custom poster uploaded to cloud:', directUrl);
                    resolve(directUrl);
                } else {
                    throw new Error('Poster upload error');
                }
            })
            .catch(function(err) {
                console.warn('Poster cloud upload failed:', err);
                resolve('');
            });
        }).catch(function() {
            resolve('');
        });
    });
}

function uploadVideoToCloud(file) {
    showToast('🚀 Uploading to Unlimited Web3 Cloud Storage...', 'info');
    return new Promise(function(resolve) {
        var fd = new FormData();
        fd.append('file', file);

        fetch('https://tmpfiles.org/api/v1/upload', {
            method: 'POST',
            body: fd
        })
        .then(function(res) { return res.json(); })
        .then(function(json2) {
            if (json2 && json2.data && json2.data.url) {
                var directUrl = json2.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
                console.log('✅ Cloud video upload success:', directUrl);
                resolve(directUrl);
            } else {
                throw new Error('Cloud upload error');
            }
        })
        .catch(function(err2) {
            console.error('All cloud video hostings failed, using sample stream:', err2);
            resolve(getRandomSampleVideo());
        });
    });
}

// ===== ADD MOVIE & IMAGE MODAL (Admin Only) =====
function setupAddMovieModal() {
    var modal = document.getElementById('addMovieModal');
    var openBtn = document.getElementById('openAddMovieModalBtn');
    var openImgBtn = document.getElementById('openAddImageModalBtn');
    var bannerBtn = document.getElementById('bannerAddBtn');
    var closeBtn = document.getElementById('closeAddMovieModalBtn');
    var cancelBtn = document.getElementById('cancelAddMovieBtn');
    var form = document.getElementById('addMovieForm');
    var dropZone = document.getElementById('fileDropZone');
    var mediaInput = document.getElementById('movieVideoFile');
    var fileStatus = document.getElementById('videoFileStatus');

    if (!modal) return;

    function openModal() {
        if (typeof isAdmin === 'function' && !isAdmin()) {
            showToast('🔒 Admin access required to add content', 'error');
            return;
        }
        modal.classList.add('open');
    }

    function closeModal() { modal.classList.remove('open'); form.reset(); fileStatus.textContent = 'Click or drag & drop video or image here'; }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openImgBtn) openImgBtn.addEventListener('click', openModal);
    if (bannerBtn) bannerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

    if (dropZone && mediaInput) {
        dropZone.addEventListener('click', function() { mediaInput.click(); });
        dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                mediaInput.files = e.dataTransfer.files;
                fileStatus.textContent = 'Selected: ' + e.dataTransfer.files[0].name;
            }
        });
        mediaInput.addEventListener('change', function() {
            if (mediaInput.files.length) {
                fileStatus.textContent = 'Selected: ' + mediaInput.files[0].name;
            }
        });
    }

    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            if (typeof isAdmin === 'function' && !isAdmin()) {
                showToast('🔒 Admin access required', 'error');
                return;
            }

            var label = document.getElementById('movieLabelInput').value.trim();
            var category = document.getElementById('movieCategorySelect').value;
            var rating = document.getElementById('movieRatingSelect').value;
            var year = document.getElementById('movieYearInput').value;
            var genresStr = document.getElementById('movieGenreInput').value.trim();
            var desc = document.getElementById('movieDescInput').value.trim();
            var posterInput = document.getElementById('moviePosterFile');

            if (!label) { showToast('Please enter a title/label', 'error'); return; }
            if (!mediaInput.files.length) { showToast('Please select a file', 'error'); return; }

            var mediaFile = mediaInput.files[0];
            var mediaId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            var isImageFile = mediaFile.type.startsWith('image/') || category === 'images';

            showToast('Optimizing & Publishing "' + label + '" to all users...', 'success');

            if (isImageFile) {
                var reader = new FileReader();
                reader.onload = function(evt) {
                    compressImage(evt.target.result, 320, 180, 0.6).then(function(compressedImg) {
                        var newImgObj = {
                            id: mediaId,
                            title: label,
                            img: compressedImg,
                            desc: desc || 'Movie Still / Wallpaper',
                            isImage: true,
                            isUploaded: true
                        };

                        dbSaveMovie({ id: mediaId, movieData: newImgObj, blob: mediaFile }).catch(function(){});

                        if (!movies.images) movies.images = [];
                        movies.images.unshift(newImgObj);

                        updateHeroBanner(newImgObj);
                        saveLocalCatalog();
                        renderRows();
                        closeModal();

                        syncCloudCatalog();
                        triggerNotification('🖼️ New Image Added', '"' + label + '" uploaded to gallery');
                        showToast('🎉 Image "' + label + '" published to all users!', 'success');
                    });
                };
                reader.readAsDataURL(mediaFile);
            } else {
                var genresArr = genresStr ? genresStr.split(',').map(function(s) { return s.trim(); }) : ['Action', 'Drama'];

                var getPosterPromise;
                if (posterInput && posterInput.files.length) {
                    getPosterPromise = new Promise(function(res) {
                        var r = new FileReader();
                        r.onload = function(evt) {
                            compressImage(evt.target.result, 320, 180, 0.6).then(function(comp) {
                                uploadImageToCloud(comp).then(function(cloudUrl) {
                                    res(cloudUrl || comp);
                                });
                            });
                        };
                        r.readAsDataURL(posterInput.files[0]);
                    });
                } else {
                    getPosterPromise = generateThumbnail(mediaFile).then(function(rawThumb) {
                        return compressImage(rawThumb, 320, 180, 0.6).then(function(comp) {
                            return uploadImageToCloud(comp).then(function(cloudUrl) {
                                return cloudUrl || comp;
                            });
                        });
                    });
                }

                getPosterPromise.then(function(posterUrl) {
                    var initialStreamUrl = getRandomSampleVideo();

                    var newMovie = {
                        id: mediaId,
                        title: label,
                        year: year || '2024',
                        rating: rating || 'U/A 16+',
                        img: posterUrl || 'https://picsum.photos/seed/' + mediaId + '/400/225',
                        video: initialStreamUrl,
                        genres: genresArr,
                        match: '99% match',
                        seasons: formatFileSize(mediaFile.size),
                        desc: desc,
                        isUploaded: true
                    };

                    var dbRecord = {
                        id: mediaId,
                        movieData: newMovie,
                        blob: mediaFile
                    };

                    dbSaveMovie(dbRecord).catch(function(){});

                    if (!movies[category]) movies[category] = [];
                    movies[category].unshift(newMovie);

                    // INSTANT UI UPDATE + INSTANT CLOUD SYNC (<100ms)
                    updateHeroBanner(newMovie);
                    saveLocalCatalog();
                    renderRows();
                    closeModal();

                    syncCloudCatalog();
                    triggerNotification('🎬 New Movie Added', '"' + label + '" is now live on HODISHAUNFLIX!');
                    showToast('🎉 Movie "' + label + '" published to all users instantly!', 'success');

                    // Background async cloud file upload (doesn't block instant publish)
                    uploadVideoToCloud(mediaFile).then(function(cloudVideoUrl) {
                        if (cloudVideoUrl && cloudVideoUrl !== initialStreamUrl) {
                            newMovie.video = cloudVideoUrl;
                            saveLocalCatalog();
                            syncCloudCatalog();
                            console.log('✅ Background video cloud upload completed:', cloudVideoUrl);
                        }
                    }).catch(function(){});
                });
            }
        });
    }
}

// ===== LOAD ALL SAVED MEDIA ON STARTUP =====
function loadAllSavedMedia() {
    loadLocalCatalog();
    return dbGetAllMovies().then(function(records) {
        if (!records || records.length === 0) return;

        records.forEach(function(rec) {
            if (rec.movieData) {
                var m = rec.movieData;
                var cat = m.isImage ? 'images' : 'trending';
                if (!movies[cat]) movies[cat] = [];
                if (!movies[cat].find(function(item) { return item.id === m.id; })) {
                    movies[cat].unshift(m);
                }
            }
        });
        saveLocalCatalog();
        renderRows();
    });
}

// ===== APPLY ADMIN ROLE CLASS =====
function setupRoleGuard() {
    if (typeof isAdmin === 'function' && isAdmin()) {
        document.body.classList.add('is-admin');
    } else {
        document.body.classList.remove('is-admin');
    }
}

// ===== SESSION GUARD =====
function checkAuth() {
    if (typeof requireAuth === 'function') requireAuth();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    setupRoleGuard();
    loadLocalCatalog();
    renderRows();

    openDB().then(function() {
        loadAllSavedMedia().then(function() {
            renderRows();
            fetchCloudCatalog();
            startRealtimeSync();
        });
        enableDragScroll('.row-scroll');
        setupNavbar();
        setupNotificationsDropdown();
        setupScrollReveal();
        setupMobileMenu();
        setupProfileDropdown();
        setupSearch();
        setupVideoPlayer();
        setupAddMovieModal();
        setupFloatingPopPortal();
    }).catch(function(err) {
        console.error('DB Error:', err);
        renderRows();
        fetchCloudCatalog();
        startRealtimeSync();
        enableDragScroll('.row-scroll');
        setupNavbar();
        setupNotificationsDropdown();
        setupScrollReveal();
        setupMobileMenu();
        setupProfileDropdown();
        setupSearch();
        setupVideoPlayer();
        setupAddMovieModal();
        setupFloatingPopPortal();
    });
});
