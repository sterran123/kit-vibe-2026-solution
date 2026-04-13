import {
  db,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from './firebase-init.js';

const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 };

export function createClassroomProgressMixin() {
  return {
    courseEnrollmentDocId: null,
    lessonProgressMap: {},
    reflectionDrafts: {},
    youtubePlayers: {},
    youtubeTrackingTimers: {},
    youtubeApiPromise: null,
    courseProgressUnsubscribe: null,
    pageLifecycleInitialized: false,

    initializeProgressLifecycle() {
      if (this.pageLifecycleInitialized) return;
      this.pageLifecycleInitialized = true;
      const persist = () => this.persistAllYoutubeProgress();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persist();
      });
      window.addEventListener('pagehide', persist);
      window.addEventListener('beforeunload', persist);
    },

    getCourseProgressDocId() {
      if (!this.courseId || !this.user?.uid) return null;
      return `${this.courseId}_${this.user.uid}`;
    },

    subscribeToCourseProgress() {
      const progressDocId = this.getCourseProgressDocId();
      if (!progressDocId) return;
      if (typeof this.courseProgressUnsubscribe === 'function') {
        this.courseProgressUnsubscribe();
      }
      this.courseProgressUnsubscribe = onSnapshot(doc(db, 'courseProgress', progressDocId), (snapshot) => {
        if (!snapshot.exists()) {
          this.lessonProgressMap = {};
          return;
        }
        const data = snapshot.data() || {};
        this.lessonProgressMap = data.lessons || {};
        const nextDrafts = { ...this.reflectionDrafts };
        Object.entries(this.lessonProgressMap).forEach(([lessonId, progress]) => {
          if (typeof progress?.youtube?.reflectionText === 'string') {
            nextDrafts[lessonId] = progress.youtube.reflectionText;
          }
        });
        this.reflectionDrafts = nextDrafts;
      });
    },

    sanitizeLessonHtml(html) {
      const rawHtml = typeof html === 'string' ? html : '';
      if (window.DOMPurify) {
        return window.DOMPurify.sanitize(rawHtml, {
          ADD_ATTR: ['style', 'class', 'target', 'rel', 'data-checkpoint', 'data-checkpoint-id']
        });
      }
      const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
      parsed.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
      parsed.body.querySelectorAll('*').forEach((node) => {
        [...node.attributes].forEach((attr) => {
          if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        });
      });
      return parsed.body.innerHTML;
    },

    extractTextCheckpointIds(content) {
      const parsed = new DOMParser().parseFromString(this.sanitizeLessonHtml(content || ''), 'text/html');
      return Array.from(parsed.body.querySelectorAll('[data-checkpoint="true"]')).map((node, index) => {
        return node.getAttribute('data-checkpoint-id') || `legacy_checkpoint_${index + 1}`;
      });
    },

    generateCheckpointId() {
      return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    },

    insertCheckpointToken() {
      if (!this.quillEditor) {
        this.initQuill();
        return;
      }
      const checkpointId = this.generateCheckpointId();
      const range = this.quillEditor.getSelection(true);
      const index = range ? range.index : this.quillEditor.getLength();
      const html = `<p><span data-checkpoint="true" data-checkpoint-id="${checkpointId}" style="display:inline-flex;align-items:center;gap:0.375rem;background:#eff6ff;color:#1d4ed8;padding:0.5rem 0.75rem;border-radius:9999px;font-weight:600;">☑ 확인했습니다 체크포인트</span></p><p><br></p>`;
      this.quillEditor.clipboard.dangerouslyPasteHTML(index, html, 'user');
    },

    buildLessonProgressState(lesson, rawProgress = {}) {
      const raw = rawProgress || {};
      const base = {
        lessonId: lesson.id,
        lessonType: lesson.type,
        percent: 0,
        completed: false,
        youtube: {
          currentTime: 0,
          duration: 0,
          watchedSeconds: 0,
          videoCompleted: false,
          reflectionText: '',
          reflectionCompleted: false
        },
        text: {
          checkedCheckpointIds: [],
          totalCheckpoints: Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds.length : 0,
          verifiedAt: null
        },
        file: {
          opened: false
        }
      };
      const merged = {
        ...base,
        ...raw,
        youtube: { ...base.youtube, ...(raw.youtube || {}) },
        text: { ...base.text, ...(raw.text || {}) },
        file: { ...base.file, ...(raw.file || {}) }
      };

      if (lesson.type === 'youtube') {
        const duration = Math.max(0, Number(merged.youtube.duration) || 0);
        const currentTime = Math.max(0, Number(merged.youtube.currentTime) || 0);
        const watchedSeconds = Math.max(Number(merged.youtube.watchedSeconds) || 0, currentTime);
        const reflectionText = typeof merged.youtube.reflectionText === 'string' ? merged.youtube.reflectionText : '';
        const videoCompleted = Boolean(merged.youtube.videoCompleted) || (duration > 0 && watchedSeconds >= Math.max(duration - 3, 0));
        const reflectionCompleted = Boolean(merged.youtube.reflectionCompleted) || reflectionText.trim().length > 0;
        const videoRatio = duration > 0 ? Math.min(watchedSeconds / duration, 1) : 0;
        const percent = videoCompleted && reflectionCompleted ? 100 : Math.min(99, Math.round(videoRatio * 90 + (reflectionCompleted ? 10 : 0)));
        return {
          ...merged,
          percent,
          completed: videoCompleted && reflectionCompleted,
          youtube: { ...merged.youtube, duration, currentTime, watchedSeconds, videoCompleted, reflectionText, reflectionCompleted }
        };
      }

      if (lesson.type === 'text') {
        const checkpointIds = Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds : [];
        const checkedCheckpointIds = (merged.text.checkedCheckpointIds || []).filter((id) => checkpointIds.includes(id));
        const allChecked = checkpointIds.length === 0 || checkedCheckpointIds.length === checkpointIds.length;
        const completed = Boolean(merged.completed) && allChecked;
        const percent = checkpointIds.length === 0 ? (completed ? 100 : 0) : Math.min(100, Math.round((checkedCheckpointIds.length / checkpointIds.length) * 90) + (completed ? 10 : 0));
        return {
          ...merged,
          percent,
          completed,
          text: { ...merged.text, checkedCheckpointIds, totalCheckpoints: checkpointIds.length, verifiedAt: completed ? (merged.text.verifiedAt || Date.now()) : null }
        };
      }

      const opened = Boolean(merged.file.opened);
      const completed = Boolean(merged.completed) && opened;
      return {
        ...merged,
        percent: completed ? 100 : (opened ? 50 : 0),
        completed,
        file: { ...merged.file, opened }
      };
    },

    getLessonProgressState(lesson) {
      return this.buildLessonProgressState(lesson, this.lessonProgressMap[lesson.id] || {});
    },

    async saveLessonProgress(lessonId, partial = {}) {
      const lesson = this.lessons.find((item) => item.id === lessonId);
      if (!lesson || this.userRole !== 'student') return;
      const current = this.getLessonProgressState(lesson);
      const next = {
        ...current,
        ...partial,
        youtube: { ...(current.youtube || {}), ...(partial.youtube || {}) },
        text: { ...(current.text || {}), ...(partial.text || {}) },
        file: { ...(current.file || {}), ...(partial.file || {}) }
      };
      this.lessonProgressMap = { ...this.lessonProgressMap, [lessonId]: next };
      await this.persistCourseProgress();
    },

    async persistCourseProgress() {
      if (this.userRole !== 'student' || !this.user?.uid || !this.courseId) return;
      const lessons = this.lessons.reduce((acc, lesson) => {
        acc[lesson.id] = this.getLessonProgressState(lesson);
        return acc;
      }, {});
      await setDoc(doc(db, 'courseProgress', this.getCourseProgressDocId()), {
        courseId: this.courseId,
        userId: this.user.uid,
        enrollmentId: this.courseEnrollmentDocId || null,
        overallProgress: this.getOverallProgressPercent(),
        completedLessons: this.getCompletedLessonsCount(),
        totalLessons: this.lessons.length,
        lessons,
        updatedAt: serverTimestamp()
      }, { merge: true });
      if (this.courseEnrollmentDocId) {
        await updateDoc(doc(db, 'courseEnrollments', this.courseEnrollmentDocId), {
          progress: this.getOverallProgressPercent(),
          completedLessons: this.getCompletedLessonsCount(),
          totalLessons: this.lessons.length,
          updatedAt: serverTimestamp()
        });
      }
    },

    ensureYoutubeApi() {
      if (window.YT?.Player) return Promise.resolve(window.YT);
      if (this.youtubeApiPromise) return this.youtubeApiPromise;
      this.youtubeApiPromise = new Promise((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof previous === 'function') previous();
          resolve(window.YT);
        };
        if (!document.getElementById('youtube-iframe-api')) {
          const script = document.createElement('script');
          script.id = 'youtube-iframe-api';
          script.src = 'https://www.youtube.com/iframe_api';
          script.async = true;
          script.onerror = reject;
          document.head.appendChild(script);
        }
      });
      return this.youtubeApiPromise;
    },

    getYoutubePlayerContainerId(lessonId) {
      return `youtube-player-${lessonId}`;
    },

    async ensureYoutubePlayer(lesson) {
      if (this.userRole !== 'student' || lesson.type !== 'youtube') return;
      await this.ensureYoutubeApi();
      const containerId = this.getYoutubePlayerContainerId(lesson.id);
      const container = document.getElementById(containerId);
      if (!container || this.youtubePlayers[lesson.id]) return;
      this.youtubePlayers[lesson.id] = new window.YT.Player(containerId, {
        videoId: lesson.content,
        events: {
          onReady: (event) => {
            const progress = this.getLessonProgressState(lesson);
            const savedTime = progress.youtube.currentTime || 0;
            const duration = event.target.getDuration ? event.target.getDuration() : 0;
            if (savedTime > 1 && duration > 0) {
              event.target.seekTo(Math.min(savedTime, Math.max(duration - 2, 0)), true);
            }
            this.saveLessonProgress(lesson.id, {
              youtube: {
                duration,
                currentTime: savedTime,
                watchedSeconds: Math.max(progress.youtube.watchedSeconds || 0, savedTime)
              }
            });
          },
          onStateChange: (event) => this.handleYoutubeStateChange(lesson, event)
        }
      });
    },

    handleYoutubeStateChange(lesson, event) {
      if (event.data === YT_STATE.PLAYING) this.startYoutubeTracking(lesson.id);
      if (event.data === YT_STATE.PAUSED) {
        this.stopYoutubeTracking(lesson.id);
        this.syncYoutubeProgress(lesson.id);
      }
      if (event.data === YT_STATE.ENDED) {
        this.stopYoutubeTracking(lesson.id);
        this.syncYoutubeProgress(lesson.id, true);
      }
    },

    startYoutubeTracking(lessonId) {
      this.stopYoutubeTracking(lessonId);
      this.youtubeTrackingTimers[lessonId] = setInterval(() => this.syncYoutubeProgress(lessonId), 5000);
    },

    stopYoutubeTracking(lessonId) {
      if (!this.youtubeTrackingTimers[lessonId]) return;
      clearInterval(this.youtubeTrackingTimers[lessonId]);
      delete this.youtubeTrackingTimers[lessonId];
    },

    syncYoutubeProgress(lessonId, ended = false) {
      const lesson = this.lessons.find((item) => item.id === lessonId);
      const player = this.youtubePlayers[lessonId];
      if (!lesson || !player?.getCurrentTime) return;
      const currentTime = Math.max(0, player.getCurrentTime() || 0);
      const duration = Math.max(0, player.getDuration() || 0);
      const progress = this.getLessonProgressState(lesson);
      this.saveLessonProgress(lessonId, {
        youtube: {
          currentTime,
          duration,
          watchedSeconds: Math.max(progress.youtube.watchedSeconds || 0, currentTime),
          videoCompleted: ended || (duration > 0 && currentTime >= Math.max(duration - 3, 0))
        }
      });
    },

    persistAllYoutubeProgress() {
      Object.keys(this.youtubePlayers).forEach((lessonId) => this.syncYoutubeProgress(lessonId));
    },

    toggleLesson(lesson) {
      lesson._open = !lesson._open;
      if (!lesson._open && lesson.type === 'youtube') this.syncYoutubeProgress(lesson.id);
      if (lesson._open && lesson.type === 'youtube') this.$nextTick(() => this.ensureYoutubePlayer(lesson));
    },

    renderTextLessonContent(lesson) {
      const parsed = new DOMParser().parseFromString(this.sanitizeLessonHtml(lesson.content || ''), 'text/html');
      const checkedIds = new Set(this.getLessonProgressState(lesson).text.checkedCheckpointIds || []);
      Array.from(parsed.body.querySelectorAll('[data-checkpoint="true"]')).forEach((node, index) => {
        const checkpointId = node.getAttribute('data-checkpoint-id') || `legacy_checkpoint_${index + 1}`;
        const checked = checkedIds.has(checkpointId);
        node.outerHTML = `<label style="display:flex;align-items:center;gap:0.625rem;padding:0.875rem 1rem;margin:1rem 0;border:1px solid ${checked ? '#bfdbfe' : '#dbeafe'};border-radius:0.875rem;background:${checked ? '#eff6ff' : '#f8fbff'};cursor:pointer;"><input type="checkbox" data-role="lesson-checkpoint" data-checkpoint-id="${checkpointId}" ${checked ? 'checked' : ''} style="width:1rem;height:1rem;accent-color:#2563eb;"><span style="font-weight:600;color:#1e3a8a;">확인했습니다</span></label>`;
      });
      return parsed.body.innerHTML;
    },

    async handleTextCheckpointChange(event, lesson) {
      const target = event.target;
      if (!target?.matches('[data-role="lesson-checkpoint"]')) return;
      const checkpointIds = Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds : [];
      const checkedIds = new Set(this.getLessonProgressState(lesson).text.checkedCheckpointIds || []);
      const checkpointId = target.getAttribute('data-checkpoint-id');
      if (target.checked) checkedIds.add(checkpointId);
      else checkedIds.delete(checkpointId);
      await this.saveLessonProgress(lesson.id, {
        completed: false,
        text: {
          checkedCheckpointIds: checkpointIds.filter((id) => checkedIds.has(id)),
          totalCheckpoints: checkpointIds.length,
          verifiedAt: null
        }
      });
    },

    async completeTextLesson(lesson) {
      const progress = this.getLessonProgressState(lesson);
      const total = Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds.length : 0;
      const checked = progress.text.checkedCheckpointIds.length;
      if (total > 0 && checked !== total) {
        Swal.fire({ icon: 'warning', title: '아직 확인하지 않은 항목이 있습니다', text: `체크포인트 ${checked}/${total}개 완료`, confirmButtonColor: '#2563eb' });
        return;
      }
      await this.saveLessonProgress(lesson.id, {
        completed: true,
        text: {
          checkedCheckpointIds: progress.text.checkedCheckpointIds,
          totalCheckpoints: total,
          verifiedAt: Date.now()
        }
      });
      Swal.fire({ icon: 'success', title: '이번 강의 내용을 수료했습니다', timer: 1200, showConfirmButton: false });
    },

    updateLessonReflectionDraft(lessonId, value) {
      this.reflectionDrafts = { ...this.reflectionDrafts, [lessonId]: value };
    },

    getLessonReflectionValue(lesson) {
      return this.reflectionDrafts[lesson.id] ?? this.getLessonProgressState(lesson).youtube.reflectionText ?? '';
    },

    async saveYoutubeReflection(lesson) {
      const reflectionText = (this.getLessonReflectionValue(lesson) || '').trim();
      if (!reflectionText) {
        Swal.fire({ icon: 'warning', title: '소감문을 입력하세요', confirmButtonColor: '#2563eb' });
        return;
      }
      await this.saveLessonProgress(lesson.id, {
        youtube: {
          reflectionText,
          reflectionCompleted: true
        }
      });
      Swal.fire({ icon: 'success', title: '소감문이 저장되었습니다', timer: 1200, showConfirmButton: false });
    },

    async markFileOpened(lesson) {
      await this.saveLessonProgress(lesson.id, { file: { opened: true } });
    },

    async completeFileLesson(lesson) {
      const progress = this.getLessonProgressState(lesson);
      if (!progress.file.opened) {
        Swal.fire({ icon: 'warning', title: '먼저 자료를 열람해 주세요', confirmButtonColor: '#2563eb' });
        return;
      }
      await this.saveLessonProgress(lesson.id, { completed: true, file: { opened: true } });
      Swal.fire({ icon: 'success', title: '자료 확인이 완료되었습니다', timer: 1200, showConfirmButton: false });
    },

    getLessonProgressPercent(lesson) {
      return this.getLessonProgressState(lesson).percent || 0;
    },

    getLessonCompleted(lesson) {
      return this.getLessonProgressState(lesson).completed;
    },

    getLessonProgressLabel(lesson) {
      const progress = this.getLessonProgressState(lesson);
      if (lesson.type === 'youtube') {
        if (progress.completed) return '영상 시청 및 소감문 작성 완료';
        if (progress.youtube.videoCompleted) return '영상 시청 완료, 소감문 작성 필요';
        return `시청 위치 ${this.formatDuration(progress.youtube.watchedSeconds)} / ${this.formatDuration(progress.youtube.duration)}`;
      }
      if (lesson.type === 'text') {
        const total = Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds.length : 0;
        return total > 0 ? `체크포인트 ${progress.text.checkedCheckpointIds.length}/${total}개 완료` : (progress.completed ? '텍스트 강의 수료 완료' : '하단 버튼으로 수료를 완료해 주세요');
      }
      return progress.completed ? '자료 확인 완료' : (progress.file.opened ? '자료 열람 완료, 확인 버튼을 눌러주세요' : '자료를 먼저 열람해 주세요');
    },

    formatDuration(seconds) {
      const safe = Math.max(0, Math.floor(seconds || 0));
      const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
      const remain = String(safe % 60).padStart(2, '0');
      return `${minutes}:${remain}`;
    },

    getCompletedLessonsCount() {
      return this.lessons.filter((lesson) => this.getLessonCompleted(lesson)).length;
    },

    getOverallProgressPercent() {
      if (!this.lessons.length) return 0;
      const total = this.lessons.reduce((sum, lesson) => sum + this.getLessonProgressPercent(lesson), 0);
      return Math.round(total / this.lessons.length);
    },

    getProgressMetricsForLessonMap(lessonMap = {}) {
      if (!this.lessons.length) {
        return {
          overallProgress: 0,
          completedLessons: 0,
          totalLessons: 0,
          reflectionCompletedCount: 0,
          reflectionRequiredCount: 0,
          checkedCheckpointCount: 0,
          totalCheckpointCount: 0
        };
      }

      const summary = this.lessons.reduce((acc, lesson) => {
        const progress = this.buildLessonProgressState(lesson, lessonMap[lesson.id] || {});
        acc.overallProgress += progress.percent || 0;
        acc.totalLessons += 1;
        if (progress.completed) acc.completedLessons += 1;
        if (lesson.type === 'youtube') {
          acc.reflectionRequiredCount += 1;
          if (progress.youtube.reflectionCompleted) acc.reflectionCompletedCount += 1;
        }
        if (lesson.type === 'text') {
          acc.checkedCheckpointCount += progress.text.checkedCheckpointIds.length;
          acc.totalCheckpointCount += Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds.length : 0;
        }
        return acc;
      }, {
        overallProgress: 0,
        completedLessons: 0,
        totalLessons: 0,
        reflectionCompletedCount: 0,
        reflectionRequiredCount: 0,
        checkedCheckpointCount: 0,
        totalCheckpointCount: 0
      });
      summary.overallProgress = summary.totalLessons > 0 ? Math.round(summary.overallProgress / summary.totalLessons) : 0;
      return summary;
    }
  };
}
