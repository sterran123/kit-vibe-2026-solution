import {
  auth, db, storage,
  onAuthStateChanged, signOut,
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from './firebase-init.js';
import { ref, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { createClassroomProgressMixin } from './classroom-progress.js';

dayjs.locale('ko');

const classroomAppDefinition = function() {
  return {
    ...createClassroomProgressMixin(),
    // State
    isLoading: true,
    user: null,
    userInitials: '',
    photoURL: null,
    userRole: null, // 'instructor' | 'student' | null
    courseId: null,
    courseInfo: null,
    lessons: [],
    students: [],
    studentProgressMap: {},
    studentProgressUnsubscribe: null,
    studentsUnsubscribe: null,
    openStudentProgressId: null,
    notices: [],
    showNoticeModal: false,
    noticeForm: { title: '', content: '', isImportant: false },
    selectedNotice: null,
    showNoticeDetailModal: false,
    showAllNotices: false,
    isSubmitting: false,
    showProfileDropdown: false,

    // Notifications
    notifications: [],
    unreadCount: 0,
    showNotifications: false,

    // Form
    form: {
      title: '',
      type: 'youtube',
      youtubeUrl: '',
      youtubePreviewId: '',
      selectedFile: null,
      uploadProgress: 0,
      scheduledDate: null, // YYYY-MM-DD format
    },
    quillEditor: null,

    // Date picker for form
    showDatePicker: false,
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),

    // View calendar for filtering
    selectedViewDate: null, // YYYY-MM-DD format
    viewCalendarMonth: new Date().getMonth(),
    viewCalendarYear: new Date().getFullYear(),

    // Year/Month picker
    showYearMonthPicker: false,
    pickerTempYear: new Date().getFullYear(),

    // Search & Pagination
    searchQuery: '',
    currentPage: 1,
    itemsPerPage: 6,

    // Edit Modal
    showEditModal: false,
    editingLesson: null,
    editForm: {
      title: '',
      content: '',
      youtubeUrl: ''
    },

    async init() {
      const params = new URLSearchParams(window.location.search);
      this.courseId = params.get('courseId');
      const noticeId = params.get('notice');

      if (!this.courseId) {
        window.location.href = 'dashboard.html';
        return;
      }

      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          window.location.href = 'login.html';
          return;
        }

        this.user = user;
        this.userInitials = this.getInitials(user.displayName || user.email);

        // Load profile photo from userProfiles
        try {
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            this.photoURL = profileDoc.data().photoURL || null;
          }
        } catch (e) {
          console.error('Profile photo load error:', e);
        }

        await this.loadCourseInfo();
        await this.determineRole();
        if (this.userRole === 'student') {
          this.initializeProgressLifecycle();
          this.subscribeToCourseProgress();
        }
        if (this.userRole === 'instructor') {
          this.subscribeToStudents();
          this.subscribeToStudentProgress();
        }
        this.subscribeToLessons();
        this.loadNotices();
        this.loadNotifications();
        this.isLoading = false;
        
        // Handle notice detail view from URL parameter
        if (noticeId) {
          this.openNoticeById(noticeId);
        }
      });
    },
    
    // Open specific notice by ID
    openNoticeById(noticeId) {
      // Wait for notices to load
      const checkNotices = () => {
        if (this.notices.length === 0) {
          setTimeout(checkNotices, 200);
          return;
        }
        const notice = this.notices.find(n => n.id === noticeId);
        if (notice) {
          this.selectedNotice = notice;
          this.showNoticeDetailModal = true;
        }
      };
      checkNotices();
    },

    // Calendar helpers
    get calendarDays() {
      return this.generateCalendarDays(this.calendarYear, this.calendarMonth);
    },

    get viewCalendarDays() {
      return this.generateCalendarDays(this.viewCalendarYear, this.viewCalendarMonth);
    },

    get filteredLessons() {
      let result = [...this.lessons];

      // 1. 날짜 필터링
      if (this.selectedViewDate) {
        // 특정 날짜가 선택된 경우 해당 날짜만
        result = result.filter(lesson => lesson.scheduledDate === this.selectedViewDate);
      }

      // 2. 검색어 필터링
      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase();
        result = result.filter(lesson => 
          lesson.title && lesson.title.toLowerCase().includes(query)
        );
      }

      // 내림차순 정렬 (최신 강의 먼저) - scheduledDate 기준
      return result.sort((a, b) => {
        const dateA = a.scheduledDate || '';
        const dateB = b.scheduledDate || '';
        return dateB.localeCompare(dateA);
      });
    },

    get paginatedLessons() {
      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      return this.filteredLessons.slice(start, end);
    },

    get totalPages() {
      return Math.ceil(this.filteredLessons.length / this.itemsPerPage);
    },

    generateCalendarDays(year, month) {
      const days = [];
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startPadding = firstDay.getDay();
      const endPadding = 6 - lastDay.getDay();
      const today = new Date();
      const todayStr = this.dateToString(today);

      // Previous month padding
      const prevMonthLastDay = new Date(year, month, 0).getDate();
      let dayIndex = 0;
      for (let i = startPadding - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        const date = new Date(year, month - 1, day);
        days.push({
          key: `prev-${day}`,
          dayOfMonth: day,
          date: this.dateToString(date),
          otherMonth: true,
          isToday: false,
          hasLesson: this.hasLessonOnDate(this.dateToString(date)),
          dayOfWeek: dayIndex % 7
        });
        dayIndex++;
      }

      // Current month
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateStr = this.dateToString(date);
        days.push({
          key: `curr-${day}`,
          dayOfMonth: day,
          date: dateStr,
          otherMonth: false,
          isToday: dateStr === todayStr,
          hasLesson: this.hasLessonOnDate(dateStr),
          dayOfWeek: dayIndex % 7
        });
        dayIndex++;
      }

      // Next month padding
      for (let day = 1; day <= endPadding; day++) {
        const date = new Date(year, month + 1, day);
        days.push({
          key: `next-${day}`,
          dayOfMonth: day,
          date: this.dateToString(date),
          otherMonth: true,
          dayOfWeek: dayIndex % 7
        });
        dayIndex++;
      }

      return days;
    },

    hasLessonOnDate(dateStr) {
      return this.lessons.some(lesson => lesson.scheduledDate === dateStr);
    },

    dateToString(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    prevMonth() {
      this.calendarMonth--;
      if (this.calendarMonth < 0) {
        this.calendarMonth = 11;
        this.calendarYear--;
      }
    },

    nextMonth() {
      this.calendarMonth++;
      if (this.calendarMonth > 11) {
        this.calendarMonth = 0;
        this.calendarYear++;
      }
    },

    prevViewMonth() {
      this.viewCalendarMonth--;
      if (this.viewCalendarMonth < 0) {
        this.viewCalendarMonth = 11;
        this.viewCalendarYear--;
      }
    },

    nextViewMonth() {
      this.viewCalendarMonth++;
      if (this.viewCalendarMonth > 11) {
        this.viewCalendarMonth = 0;
        this.viewCalendarYear++;
      }
    },

    selectDate(dateStr) {
      this.form.scheduledDate = dateStr;
      this.showDatePicker = false;
    },

    selectViewDate(dateStr) {
      this.selectedViewDate = dateStr;
    },

    clearDateFilter() {
      this.selectedViewDate = null;
    },

    isSelectedDate(dateStr) {
      return this.form.scheduledDate === dateStr;
    },

    isViewSelectedDate(dateStr) {
      return this.selectedViewDate === dateStr;
    },

    // Notifications
    async loadNotifications() {
      if (!this.user) return;
      
      const { db, query, collection, where, orderBy, limit, onSnapshot } = await import('./firebase-init.js');
      
      const notifQ = query(
        collection(db, 'notifications'),
        where('user_id', '==', this.user.uid),
        where('read', '==', false),
        orderBy('created_at', 'desc'),
        limit(10)
      );
      
      onSnapshot(notifQ, (snapshot) => {
        this.notifications = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        this.unreadCount = this.notifications.length;
      });
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const lessonId = notification.lessonId || notification.lesson_id;
      const postId = notification.postId || notification.post_id;
      const postType = notification.postType || notification.post_type || 'post';
      const ticketId = notification.ticketId || notification.ticket_id;

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }

      if (ticketId) {
        return `my-tickets.html?ticketId=${ticketId}`;
      }

      if (courseId) {
        return lessonId
          ? `classroom.html?courseId=${courseId}&lessonId=${lessonId}`
          : `classroom.html?courseId=${courseId}`;
      }

      if (notification.link) {
        return notification.link;
      }

      return null;
    },

    async handleNotification(notification) {
      const { db, updateDoc, doc, serverTimestamp } = await import('./firebase-init.js');
      
      // Mark as read
      await updateDoc(doc(db, 'notifications', notification.id), {
        read: true,
        updated_at: serverTimestamp()
      });
      
      this.showNotifications = false;
      
      // Remove from local array
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        const currentUrl = `classroom.html?courseId=${this.courseId}`;
        if (targetUrl !== currentUrl || (notification.lessonId || notification.lesson_id)) {
          window.location.href = targetUrl;
        }
      }
    },

    formatDateFull(dateStr) {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('-');
      return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일`;
    },

    // Year/Month picker methods
    openYearMonthPicker() {
      this.pickerTempYear = this.viewCalendarYear;
      this.showYearMonthPicker = true;
    },

    changePickerYear(delta) {
      this.pickerTempYear += delta;
    },

    selectPickerMonth(month) {
      this.viewCalendarYear = this.pickerTempYear;
      this.viewCalendarMonth = month;
      this.showYearMonthPicker = false;
    },

    closeYearMonthPicker() {
      this.showYearMonthPicker = false;
    },

    async loadCourseInfo() {
      try {
        const courseDoc = await getDoc(doc(db, 'courseRequests', this.courseId));
        if (courseDoc.exists()) {
          this.courseInfo = { id: courseDoc.id, ...courseDoc.data() };
        }
      } catch (e) {
        console.error('loadCourseInfo error:', e);
      }
    },

    async determineRole() {
      if (!this.courseInfo || !this.user) return;

      // Check if user is the instructor
      if (this.courseInfo.instructorId === this.user.uid) {
        this.userRole = 'instructor';
        return;
      }

      // Check if user is enrolled
      try {
        const enrollQ = query(
          collection(db, 'courseEnrollments'),
          where('studentId', '==', this.user.uid),
          where('courseId', '==', this.courseId)
        );
        const snap = await new Promise((res, rej) => {
          const unsub = onSnapshot(enrollQ, (s) => { unsub(); res(s); }, rej);
        });
        if (!snap.empty) {
          this.courseEnrollmentDocId = snap.docs[0].id;
          this.userRole = 'student';
        } else {
          // Also check user role in Firestore profile
          const userDoc = await getDoc(doc(db, 'users', this.user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.role === 'instructor' && this.courseInfo.instructorId === this.user.uid) {
              this.userRole = 'instructor';
            } else if (userData.role === 'admin') {
              this.userRole = 'instructor'; // admin gets instructor view
            } else {
              // For dev/demo: allow any authenticated user
              this.userRole = 'student';
            }
          } else {
            this.userRole = 'student';
          }
        }
      } catch (e) {
        console.error('determineRole error:', e);
        this.userRole = 'student';
      }
    },

    subscribeToLessons() {
      const q = query(
        collection(db, 'courseLessons'),
        where('courseId', '==', this.courseId),
        orderBy('order', 'asc')
      );
      onSnapshot(q, (snap) => {
        this.lessons = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          _checkpointIds: this.extractTextCheckpointIds(d.data().content || ''),
          _open: false
        }));
      }, (err) => {
        // Fallback without ordering if index not ready
        const q2 = query(collection(db, 'courseLessons'), where('courseId', '==', this.courseId));
        onSnapshot(q2, (snap2) => {
          this.lessons = snap2.docs.map(d => ({
            id: d.id,
            ...d.data(),
            _checkpointIds: this.extractTextCheckpointIds(d.data().content || ''),
            _open: false
          })).sort((a, b) => (a.order || 0) - (b.order || 0));
        });
      });
    },

    subscribeToStudents() {
      if (!this.courseId) return;
      if (typeof this.studentsUnsubscribe === 'function') {
        this.studentsUnsubscribe();
      }
      const q = query(
        collection(db, 'courseEnrollments'),
        where('courseId', '==', this.courseId),
        where('status', '==', 'approved')
      );
      this.studentsUnsubscribe = onSnapshot(q, (snap) => {
        this.students = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const aTime = a.appliedAt?.toMillis?.() || 0;
            const bTime = b.appliedAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
      }, (err) => {
        console.error('subscribeToStudents error:', err);
        this.students = [];
      });
    },

    subscribeToStudentProgress() {
      if (!this.courseId) return;
      if (typeof this.studentProgressUnsubscribe === 'function') {
        this.studentProgressUnsubscribe();
      }
      const q = query(
        collection(db, 'courseProgress'),
        where('courseId', '==', this.courseId)
      );
      this.studentProgressUnsubscribe = onSnapshot(q, (snap) => {
        this.studentProgressMap = snap.docs.reduce((acc, d) => {
          const data = d.data() || {};
          if (data.userId) {
            acc[data.userId] = { id: d.id, ...data };
          }
          return acc;
        }, {});
      }, (err) => {
        console.error('subscribeToStudentProgress error:', err);
        this.studentProgressMap = {};
      });
    },

    getStudentIdentifier(student) {
      return student?.studentId || student?.student_uid || student?.userId || student?.id;
    },

    getStudentProgressRecord(student) {
      return this.studentProgressMap[this.getStudentIdentifier(student)] || null;
    },

    getStudentProgressMetrics(student) {
      const record = this.getStudentProgressRecord(student);
      return this.getProgressMetricsForLessonMap(record?.lessons || {});
    },

    getStudentOverallProgress(student) {
      const record = this.getStudentProgressRecord(student);
      if (record && typeof record.overallProgress === 'number') {
        return Math.round(record.overallProgress);
      }
      return this.getStudentProgressMetrics(student).overallProgress || Math.round(Number(student?.progress) || 0);
    },

    getStudentCompletedLessonsCount(student) {
      const record = this.getStudentProgressRecord(student);
      if (record && typeof record.completedLessons === 'number') {
        return Number(record.completedLessons) || 0;
      }
      return this.getStudentProgressMetrics(student).completedLessons || Number(student?.completedLessons) || 0;
    },

    getStudentTotalLessonsCount(student) {
      const record = this.getStudentProgressRecord(student);
      if (record && typeof record.totalLessons === 'number' && record.totalLessons > 0) {
        return Number(record.totalLessons) || 0;
      }
      return Number(student?.totalLessons) || this.lessons.length;
    },

    getStudentCheckpointSummary(student) {
      const metrics = this.getStudentProgressMetrics(student);
      return `${metrics.checkedCheckpointCount}/${metrics.totalCheckpointCount}`;
    },

    getStudentReflectionSummary(student) {
      const metrics = this.getStudentProgressMetrics(student);
      return `${metrics.reflectionCompletedCount}/${metrics.reflectionRequiredCount}`;
    },

    getStudentProgressLabel(student) {
      const progress = this.getStudentOverallProgress(student);
      if (progress >= 100) return '전체 강의 수료 완료';
      if (progress >= 80) return '수료 직전';
      if (progress > 0) return '학습 진행 중';
      return '아직 시작 전';
    },

    toggleStudentProgress(student) {
      this.openStudentProgressId = this.openStudentProgressId === student.id ? null : student.id;
    },

    getStudentLessonReports(student) {
      const lessonsMap = this.getStudentProgressRecord(student)?.lessons || {};
      return this.lessons.map((lesson) => {
        const progress = this.buildLessonProgressState(lesson, lessonsMap[lesson.id] || {});
        return {
          lesson,
          progress,
          detail: this.getStudentLessonDetailLabel(lesson, progress)
        };
      });
    },

    getStudentReflectionText(report) {
      if (report?.lesson?.type !== 'youtube') return '';
      return (report?.progress?.youtube?.reflectionText || '').trim();
    },

    getStudentLessonDetailLabel(lesson, progress) {
      if (lesson.type === 'youtube') {
        return progress.youtube.reflectionCompleted
          ? `소감문 제출 완료 · ${this.formatDuration(progress.youtube.watchedSeconds)} / ${this.formatDuration(progress.youtube.duration)}`
          : `소감문 미제출 · ${this.formatDuration(progress.youtube.watchedSeconds)} / ${this.formatDuration(progress.youtube.duration)}`;
      }
      if (lesson.type === 'text') {
        return `체크포인트 ${progress.text.checkedCheckpointIds.length}/${Array.isArray(lesson._checkpointIds) ? lesson._checkpointIds.length : 0}`;
      }
      return progress.file.opened ? '자료 열람 완료' : '자료 미열람';
    },

    getInstructorAverageProgress() {
      if (!this.students.length) return 0;
      const total = this.students.reduce((sum, student) => sum + this.getStudentOverallProgress(student), 0);
      return Math.round(total / this.students.length);
    },

    getInstructorReflectionOverview() {
      return this.students.reduce((acc, student) => {
        const metrics = this.getStudentProgressMetrics(student);
        acc.completed += metrics.reflectionCompletedCount;
        acc.total += metrics.reflectionRequiredCount;
        return acc;
      }, { completed: 0, total: 0 });
    },

    getInstructorCheckpointOverview() {
      return this.students.reduce((acc, student) => {
        const metrics = this.getStudentProgressMetrics(student);
        acc.checked += metrics.checkedCheckpointCount;
        acc.total += metrics.totalCheckpointCount;
        return acc;
      }, { checked: 0, total: 0 });
    },

    getInstructorCompletedStudentCount() {
      return this.students.filter((student) => this.getStudentOverallProgress(student) >= 100).length;
    },

    // 수강생에게 새 강의글 알림 발송
    async notifyStudentsNewLesson(lessonData) {
      
      try {
        if (!this.courseId) {
          console.error('[notifyStudentsNewLesson] No courseId available');
          return;
        }
        
        if (!lessonData?.id) {
          console.error('[notifyStudentsNewLesson] No lessonId available');
          return;
        }
        
        // courseEnrollments에서 해당 강의의 수강생 목록 조회
        const enrollQ = query(
          collection(db, 'courseEnrollments'),
          where('courseId', '==', this.courseId),
          where('status', '==', 'approved')
        );
        
        const enrollSnap = await getDocs(enrollQ);
        
        if (enrollSnap.docs.length === 0) {
          return;
        }
        
        const notifications = enrollSnap.docs.map(enrollDoc => {
          const enrollData = enrollDoc.data();
          
          // studentId 또는 student_uid 필드 사용
          const targetUserId = enrollData.studentId || enrollData.student_uid;
          
          if (!targetUserId) {
            console.warn('[notifyStudentsNewLesson] No student ID found in enrollment:', enrollDoc.id);
          }
          
          return {
            user_id: targetUserId,
            type: 'new_lesson',
            title: '새 강의글이 등록되었습니다',
            message: `${this.courseInfo?.courseName || '강의'}에 "${lessonData.title}" 강의가 새로 등록되었습니다.`,
            courseId: this.courseId,
            lessonId: lessonData.id,
            read: false,
            created_at: serverTimestamp()
          };
        }).filter(n => n.user_id); // user_id가 없는 알림 제거

        
        // 배치로 알림 저장
        let successCount = 0;
        for (const notif of notifications) {
          try {
            const notifRef = await addDoc(collection(db, 'notifications'), notif);
            successCount++;
          } catch (notifErr) {
            console.error('[notifyStudentsNewLesson] Failed to save notification:', notifErr);
          }
        }
        
        
        // 강사에게도 성공 메시지 표시
        Swal.fire({
          icon: 'success',
          title: '강의글이 등록되었습니다',
          text: `${successCount}명의 수강생에게 알림이 발송되었습니다.`,
          timer: 2000,
          showConfirmButton: false
        });
        
      } catch (err) {
        console.error('[notifyStudentsNewLesson] Error:', err);
        Swal.fire({
          icon: 'error',
          title: '알림 발송 실패',
          text: '강의글은 등록되었지만, 학생들에게 알림을 보내지 못했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },

    initQuill() {
      if (this.quillEditor) return;
      this.$nextTick(() => {
        const el = document.getElementById('quill-editor');
        if (!el || el.classList.contains('ql-container')) return;
        this.quillEditor = new Quill('#quill-editor', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ 'size': ['small', false, 'large', 'huge'] }],
              ['bold', 'italic', 'underline'],
              [{ 'color': [] }, { 'background': [] }],
              ['code-block', 'blockquote', 'link', 'image'],
              [{ 'align': [] }],
              [{ 'list': 'ordered' }, { 'list': 'bullet' }],
              ['clean']
            ]
          }
        });
      });
    },

    initEditQuill(content) {
      // Wait for modal transition to complete
      setTimeout(() => {
        const existing = document.querySelector('#quill-edit-editor .ql-container');
        if (existing) {
          // Already initialized — just set content
          if (this.editQuillEditor) {
            this.editQuillEditor.root.innerHTML = content || '';
          }
          return;
        }
        this.editQuillEditor = new Quill('#quill-edit-editor', {
          theme: 'snow',
          modules: {
            toolbar: [
              ['bold', 'italic', 'underline'],
              [{ 'color': [] }, { 'background': [] }],
              ['code-block', 'blockquote', 'link'],
              [{ 'list': 'ordered' }, { 'list': 'bullet' }],
              ['clean']
            ]
          }
        });
        if (content) {
          this.editQuillEditor.root.innerHTML = content;
        }
      }, 150);
    },

    extractYoutubeId(url) {
      if (!url) return '';
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /youtube\.com\/shorts\/([^&\n?#]+)/
      ];
      for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
      }
      return '';
    },

    previewYoutube() {
      this.form.youtubePreviewId = this.extractYoutubeId(this.form.youtubeUrl);
    },

    previewEditYoutube() {
      this.editForm.youtubePreviewId = this.extractYoutubeId(this.editForm.youtubeUrl);
    },

    resetContent() {
      this.form.youtubeUrl = '';
      this.form.youtubePreviewId = '';
      this.form.selectedFile = null;
      this.form.uploadProgress = 0;
      if (this.quillEditor) {
        this.quillEditor.setContents([]);
      }
    },

    handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        this.form.selectedFile = file;
      }
    },

    async uploadFile(file) {
      return new Promise((resolve, reject) => {
        const ext = file.name.split('.').pop();
        const path = `courseLessons/${this.courseId}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on('state_changed',
          (snapshot) => {
            this.form.uploadProgress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
          },
          (error) => reject(error),
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });
    },

    async submitLesson() {
      if (!this.form.title.trim()) {
        Swal.fire({ icon: 'warning', title: '제목을 입력하세요', confirmButtonColor: '#2563eb' });
        return;
      }

      // 날짜 무결성 검증
      if (!this.form.scheduledDate) {
        Swal.fire({ icon: 'warning', title: '강의 일정을 선택하세요', text: '달력에서 강의가 공개될 날짜를 선택해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }

      // 선택한 날짜가 유효한 형식인지 검증
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(this.form.scheduledDate)) {
        Swal.fire({ icon: 'error', title: '날짜 형식 오류', text: '날짜 형식이 올바르지 않습니다.', confirmButtonColor: '#2563eb' });
        return;
      }

      this.isSubmitting = true;
      try {
        let content = '';
        let fileName = '';
        let fileType = '';

        if (this.form.type === 'youtube') {
          const videoId = this.extractYoutubeId(this.form.youtubeUrl);
          if (!videoId) {
            Swal.fire({ icon: 'warning', title: '올바른 YouTube URL을 입력하세요', confirmButtonColor: '#2563eb' });
            this.isSubmitting = false;
            return;
          }
          content = videoId;

        } else if (this.form.type === 'text') {
          if (!this.quillEditor) {
            Swal.fire({ icon: 'warning', title: '에디터가 초기화되지 않았습니다', confirmButtonColor: '#2563eb' });
            this.isSubmitting = false;
            return;
          }
          content = this.quillEditor.root.innerHTML;
          if (!content || content === '<p><br></p>') {
            Swal.fire({ icon: 'warning', title: '강의 내용을 입력하세요', confirmButtonColor: '#2563eb' });
            this.isSubmitting = false;
            return;
          }

        } else if (this.form.type === 'file') {
          if (!this.form.selectedFile) {
            Swal.fire({ icon: 'warning', title: '파일을 선택하세요', confirmButtonColor: '#2563eb' });
            this.isSubmitting = false;
            return;
          }
          content = await this.uploadFile(this.form.selectedFile);
          fileName = this.form.selectedFile.name;
          fileType = this.form.selectedFile.type || this.form.selectedFile.name.split('.').pop().toUpperCase();
        }

        const lessonData = {
          courseId: this.courseId,
          title: this.form.title.trim(),
          type: this.form.type,
          content,
          fileName,
          fileType,
          order: this.lessons.length,
          createdAt: serverTimestamp(),
          instructorId: this.user.uid,
          scheduledDate: this.form.scheduledDate // YYYY-MM-DD format - 달력 무결성 확보
        };

        const lessonRef = await addDoc(collection(db, 'courseLessons'), lessonData);
        lessonData.id = lessonRef.id;

        // 수강생에게 새 강의글 알림 발송
        await this.notifyStudentsNewLesson(lessonData);

        // 폼 초기화
        this.form.title = '';
        this.form.scheduledDate = null;
        this.form.type = 'youtube';
        this.resetContent();
        if (this.quillEditor) {
          this.quillEditor = null;
          const el = document.getElementById('quill-editor');
          if (el) el.innerHTML = '';
        }
        // Reset calendar to current month
        const now = new Date();
        this.calendarMonth = now.getMonth();
        this.calendarYear = now.getFullYear();

        Swal.fire({
          icon: 'success',
          title: '강의가 게시되었습니다!',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (err) {
        console.error('submitLesson error:', err);
        Swal.fire({ icon: 'error', title: '게시 실패', text: err.message, confirmButtonColor: '#2563eb' });
      } finally {
        this.isSubmitting = false;
      }
    },

    openEditModal(lesson) {
      this.editingLesson = lesson;
      this.editForm = {
        title: lesson.title || '',
        content: lesson.content || '',
        youtubeUrl: lesson.type === 'youtube' ? `https://www.youtube.com/watch?v=${lesson.content}` : ''
      };
      this.showEditModal = true;
    },

    closeEditModal() {
      this.showEditModal = false;
      this.editingLesson = null;
      this.editForm = { title: '', content: '', youtubeUrl: '' };
    },

    async saveEdit() {
      if (!this.editForm.title.trim()) {
        Swal.fire({ icon: 'warning', title: '제목을 입력하세요', confirmButtonColor: '#2563eb' });
        return;
      }
      this.isSubmitting = true;
      try {
        const updates = {
          title: this.editForm.title.trim(),
          updated_at: serverTimestamp()
        };
        if (this.editingLesson.type === 'text') {
          updates.content = this.editForm.content;
        } else if (this.editingLesson.type === 'youtube') {
          const vid = this.extractYoutubeId(this.editForm.youtubeUrl);
          if (!vid) {
            Swal.fire({ icon: 'warning', title: '올바른 YouTube URL을 입력하세요', confirmButtonColor: '#2563eb' });
            this.isSubmitting = false;
            return;
          }
          updates.content = vid;
        }
        await updateDoc(doc(db, 'courseLessons', this.editingLesson.id), updates);
        this.closeEditModal();
        Swal.fire({ icon: 'success', title: '수정되었습니다!', timer: 1200, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ icon: 'error', title: '수정 실패', text: err.message, confirmButtonColor: '#2563eb' });
      } finally {
        this.isSubmitting = false;
      }
    },

    async deleteLesson(lessonId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '강의를 삭제하시겠습니까?',
        text: '삭제 후 복구할 수 없습니다.',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });
      if (!result.isConfirmed) return;

      try {
        await deleteDoc(doc(db, 'courseLessons', lessonId));
        Swal.fire({ icon: 'success', title: '삭제되었습니다.', timer: 1200, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message, confirmButtonColor: '#2563eb' });
      }
    },

    async doLogout() {
      await signOut(auth);
      window.location.href = 'login.html';
    },

    getInitials(name) {
      if (!name) return '?';
      const words = name.trim().split(/\s+/);
      if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
      return name.substring(0, 2).toUpperCase();
    },

    getCategoryText(cat) {
      const map = { math: '수학', science: '과학', english: '영어', programming: '프로그래밍', history: '역사', other: '기타' };
      return map[cat] || cat || '강의';
    },

    formatDate(ts) {
      if (!ts) return '';
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      return dayjs(d).locale('ko').format('YYYY.MM.DD');
    },

    formatRelativeTime(ts) {
      if (!ts) return '';
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      const relative = dayjs(d).locale('ko');
      if (typeof relative.fromNow === 'function') {
        return relative.fromNow();
      }

      const diffMs = Date.now() - d.getTime();
      if (!Number.isFinite(diffMs)) return this.formatDate(d);

      const diffMinutes = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMinutes < 1) return '방금 전';
      if (diffMinutes < 60) return `${diffMinutes}분 전`;
      if (diffHours < 24) return `${diffHours}시간 전`;
      if (diffDays < 7) return `${diffDays}일 전`;
      return dayjs(d).locale('ko').format('YYYY.MM.DD');
    },

    async loadNotices() {
      if (!this.courseId) return;
      try {
        const q = query(
          collection(db, 'courseNotices'),
          where('courseId', '==', this.courseId),
          orderBy('isImportant', 'desc'),
          orderBy('createdAt', 'desc')
        );
        onSnapshot(q, (snap) => {
          this.notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        });
      } catch (err) {
        console.error('Load notices error:', err);
      }
    },

    async deleteNotice(noticeId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '공지사항을 삭제하시겠습니까?',
        text: '삭제 후 복구할 수 없습니다.',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });
      if (!result.isConfirmed) return;

      try {
        await deleteDoc(doc(db, 'courseNotices', noticeId));
        Swal.fire({ icon: 'success', title: '삭제되었습니다.', timer: 1200, showConfirmButton: false });
      } catch (err) {
        console.error('Delete notice error:', err);
        Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message, confirmButtonColor: '#2563eb' });
      }
    },

    // Pagination computed property
    get visiblePages() {
      const maxVisible = 5;
      const pages = [];
      const total = this.totalPages;
      const current = this.currentPage;
      if (total <= maxVisible) {
        for (let i = 1; i <= total; i++) pages.push(i);
      } else {
        let start = Math.max(1, current - 2);
        let end = Math.min(total, current + 2);
        if (end - start < maxVisible - 1) {
          if (start === 1) end = Math.min(total, start + maxVisible - 1);
          else if (end === total) start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) pages.push(i);
      }
      return pages;
    },

    get totalPages() {
      return Math.ceil(this.filteredLessons.length / this.itemsPerPage);
    },

    get filteredLessons() {
      let result = this.lessons;
      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase();
        result = result.filter(l => l.title?.toLowerCase().includes(q));
      }
      if (this.selectedViewDate) {
        result = result.filter(l => l.scheduledDate === this.selectedViewDate);
      }
      return result;
    },

    get paginatedLessons() {
      const start = (this.currentPage - 1) * this.itemsPerPage;
      return this.filteredLessons.slice(start, start + this.itemsPerPage);
    },

    async submitNotice() {
      if (!this.noticeForm.title.trim()) {
        Swal.fire({ icon: 'warning', title: '제목을 입력하세요', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.noticeForm.content.trim()) {
        Swal.fire({ icon: 'warning', title: '내용을 입력하세요', confirmButtonColor: '#2563eb' });
        return;
      }
      this.isSubmitting = true;
      try {
        const noticeData = {
          courseId: this.courseId,
          title: this.noticeForm.title.trim(),
          content: this.noticeForm.content.trim(),
          isImportant: this.noticeForm.isImportant,
          createdBy: this.user?.uid,
          createdByName: this.user?.displayName || '강사',
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'courseNotices'), noticeData);
        this.showNoticeModal = false;
        this.noticeForm = { title: '', content: '', isImportant: false };
        Swal.fire({ icon: 'success', title: '공지사항이 등록되었습니다', timer: 1200, showConfirmButton: false });
      } catch (err) {
        console.error('Submit notice error:', err);
        Swal.fire({ icon: 'error', title: '등록 실패', text: err.message, confirmButtonColor: '#2563eb' });
      } finally {
        this.isSubmitting = false;
      }
    }
  };
};

window.classroomApp = classroomAppDefinition;

const registerClassroomApp = () => {
  if (!window.Alpine) return;
  window.Alpine.data('classroomApp', classroomAppDefinition);
};

if (window.Alpine) {
  registerClassroomApp();
}

document.addEventListener('alpine:init', registerClassroomApp);
