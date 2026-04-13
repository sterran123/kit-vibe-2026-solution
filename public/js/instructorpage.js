const _fbInstructorPage = import('./firebase-init.js?v=4');

window.instructorPageApp = function() {
  return {
    user: null,
    userInitials: '',
    userRole: null,
    showNotifications: false,
    unreadCount: 0,
    notifications: [],
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],
    showProfileDropdown: false,
    instructorStats: {
      totalCourses: 0,
      totalStudents: 0,
      pendingTickets: 0
    },
    profile: {
      displayName: '',
      email: '',
      photoURL: null
    },
    profileForm: {
      displayName: '',
      email: ''
    },
    passwordForm: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    },
    // Photo upload
    showPhotoUploadModal: false,
    photoFile: null,
    photoPreview: null,
    uploading: false,

    async init() {
      const fb = await _fbInstructorPage;
      fb.onAuthStateChanged(fb.auth, async (user) => {
        if (user) {
          this.user = user;
          this.userInitials = user.displayName ? user.displayName.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() || '?';
          this.profile.email = user.email || '';
          await this.loadUserProfile(fb);
          await this.loadNotifications(fb);
          
          // Role check - only instructors/admins/staff can access
          if (!['instructor', 'admin', 'staff'].includes(this.userRole)) {
            Swal.fire({
              icon: 'error',
              title: '접근 권한 없음',
              text: '강사/관리자 전용 페이지입니다.',
              confirmButtonColor: '#2563eb'
            }).then(() => {
              window.location.href = 'mypage.html';
            });
            return;
          }
          
          await this.loadInstructorStats(fb);
        } else {
          window.location.href = 'login.html';
        }
      });
    },

    async loadUserProfile(fb) {
      try {
        const userDocRef = fb.doc(fb.db, 'users', this.user.uid);
        const userDoc = await fb.getDoc(userDocRef);
        if (userDoc.exists()) {
          const userData = userDoc.data();
          this.userRole = userData.role || '수강생';
        } else {
          this.userRole = '수강생';
        }

        const profileDocRef = fb.doc(fb.db, 'userProfiles', this.user.uid);
        const profileDoc = await fb.getDoc(profileDocRef);
        if (profileDoc.exists()) {
          const data = profileDoc.data();
          this.profile.displayName = data.displayName || this.user.displayName || '';
          this.profile.photoURL = data.photoURL || null;
          this.profileForm.displayName = this.profile.displayName;
        } else {
          this.profile.displayName = this.user.displayName || '';
          this.profileForm.displayName = this.profile.displayName;
          await fb.setDoc(profileDocRef, {
            displayName: this.profile.displayName,
            email: this.user.email,
            photoURL: null,
            createdAt: fb.serverTimestamp()
          });
        }
      } catch (e) {
        console.error('Profile load error:', e);
      }
    },

    async loadInstructorStats(fb) {
      try {
        const coursesQuery = fb.query(
          fb.collection(fb.db, 'courseRequests'),
          fb.where('instructorId', '==', this.user.uid),
          fb.where('status', '==', 'approved')
        );
        fb.onSnapshot(coursesQuery, (snap) => {
          this.instructorStats.totalCourses = snap.docs.length;
        });

        const enrollQuery = fb.query(
          fb.collection(fb.db, 'courseEnrollments'),
          fb.where('instructorId', '==', this.user.uid),
          fb.where('status', '==', 'approved')
        );
        fb.onSnapshot(enrollQuery, (snap) => {
          this.instructorStats.totalStudents = snap.docs.length;
        });

        const ticketQuery = fb.query(
          fb.collection(fb.db, 'tickets'),
          fb.where('instructor_id', '==', this.user.uid),
          fb.where('status', 'in', ['pending', 'in-progress'])
        );
        fb.onSnapshot(ticketQuery, (snap) => {
          this.instructorStats.pendingTickets = snap.docs.length;
        });
      } catch (e) {
        console.error('Instructor stats load error:', e);
      }
    },

    async saveProfile() {
      try {
        const fb = await _fbInstructorPage;
        await fb.updateProfile(this.user, { displayName: this.profileForm.displayName });
        const userDocRef = fb.doc(fb.db, 'userProfiles', this.user.uid);
        await fb.updateDoc(userDocRef, {
          displayName: this.profileForm.displayName,
          updatedAt: fb.serverTimestamp()
        });
        this.profile.displayName = this.profileForm.displayName;
        this.userInitials = this.profileForm.displayName.charAt(0).toUpperCase();
        Swal.fire({ icon: 'success', title: '저장 완료', text: '프로필이 업데이트되었습니다.', confirmButtonColor: '#2563eb' });
      } catch (error) {
        Swal.fire({ icon: 'error', title: '오류', text: error.message, confirmButtonColor: '#2563eb' });
      }
    },

    resetProfileForm() {
      this.profileForm.displayName = this.profile.displayName || '';
    },

    async changePassword() {
      if (this.passwordForm.newPassword.length < 6) {
        Swal.fire({ icon: 'warning', title: '비밀번호 오류', text: '비밀번호는 6자 이상이어야 합니다.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
        Swal.fire({ icon: 'warning', title: '비밀번호 불일치', text: '새 비밀번호가 일치하지 않습니다.', confirmButtonColor: '#2563eb' });
        return;
      }

      try {
        const fb = await _fbInstructorPage;
        const { EmailAuthProvider, reauthenticateWithCredential } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
        const credential = EmailAuthProvider.credential(this.user.email, this.passwordForm.currentPassword);
        await reauthenticateWithCredential(this.user, credential);
        await fb.updatePassword(this.user, this.passwordForm.newPassword);
        Swal.fire({ icon: 'success', title: '변경 완료', text: '비밀번호가 변경되었습니다.', confirmButtonColor: '#2563eb' });
        this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
      } catch (error) {
        Swal.fire({ icon: 'error', title: '오류', text: '현재 비밀번호가 올바르지 않거나 오류가 발생했습니다.', confirmButtonColor: '#2563eb' });
      }
    },

    // Photo upload methods
    handlePhotoSelect(e) {
      const file = e.target.files[0];
      if (file) this.processPhoto(file);
    },

    handlePhotoDrop(e) {
      const file = e.dataTransfer.files[0];
      if (file) this.processPhoto(file);
    },

    processPhoto(file) {
      if (!file.type.startsWith('image/')) {
        Swal.fire({ icon: 'warning', title: '잘못된 파일', text: '이미지 파일만 업로드 가능합니다.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        Swal.fire({ icon: 'warning', title: '파일 크기 초과', text: '5MB 이하의 이미지를 선택해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      this.photoFile = file;
      const reader = new FileReader();
      reader.onload = (e) => { this.photoPreview = e.target.result; };
      reader.readAsDataURL(file);
    },

    async uploadPhoto() {
      if (!this.photoFile) return;
      this.uploading = true;
      try {
        const fb = await _fbInstructorPage;
        const storageRef = fb.ref(fb.storage, `profilePhotos/${this.user.uid}/${Date.now()}_${this.photoFile.name}`);
        await fb.uploadBytes(storageRef, this.photoFile);
        const downloadURL = await fb.getDownloadURL(storageRef);
        
        await fb.updateProfile(this.user, { photoURL: downloadURL });
        
        const userDocRef = fb.doc(fb.db, 'userProfiles', this.user.uid);
        await fb.updateDoc(userDocRef, { photoURL: downloadURL, updatedAt: fb.serverTimestamp() });
        
        this.profile.photoURL = downloadURL;
        this.showPhotoUploadModal = false;
        this.photoFile = null;
        this.photoPreview = null;
        Swal.fire({ icon: 'success', title: '업로드 완료', text: '프로필 사진이 변경되었습니다.', confirmButtonColor: '#2563eb' });
      } catch (error) {
        console.error('Photo upload error:', error);
        Swal.fire({ icon: 'error', title: '업로드 실패', text: '사진 업로드 중 오류가 발생했습니다.', confirmButtonColor: '#2563eb' });
      } finally {
        this.uploading = false;
      }
    },

    formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    },

    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    async doLogout() {
      const fb = await _fbInstructorPage;
      await fb.signOut(fb.auth);
      window.location.href = 'index.html';
    },

    // Notifications
    async loadNotifications(fb) {
      this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
      this.notificationUnsubscribes = [];
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];

      const subscribeByField = (fieldName, targetKey) => {
        const notifQ = fb.query(
          fb.collection(fb.db, 'notifications'),
          fb.where(fieldName, '==', this.user.uid),
          fb.where('read', '==', false),
          fb.orderBy('created_at', 'desc'),
          fb.limit(10)
        );
        const unsubscribe = fb.onSnapshot(notifQ, (snap) => {
          this[targetKey] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          this.mergeNotifications();
        }, (error) => {
          console.error(`Notifications load error (${fieldName}):`, error);
          this[targetKey] = [];
          this.mergeNotifications();
        });
        this.notificationUnsubscribes.push(unsubscribe);
      };

      subscribeByField('user_id', 'notificationLegacyItems');
      subscribeByField('recipientId', 'notificationRecipientItems');
    },

    mergeNotifications() {
      const merged = [...this.notificationLegacyItems, ...this.notificationRecipientItems];
      const deduped = Array.from(new Map(merged.map(item => [item.id, item])).values());
      deduped.sort((a, b) => this.getNotificationTimestamp(b) - this.getNotificationTimestamp(a));
      this.notifications = deduped;
      this.unreadCount = deduped.length;
    },

    getNotificationTimestamp(notification) {
      const value = notification?.created_at || notification?.createdAt;
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') return value.seconds * 1000;
      return new Date(value).getTime() || 0;
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const lessonId = notification.lessonId || notification.lesson_id;
      const postId = notification.postId || notification.post_id;
      const postType = notification.postType || notification.post_type || 'post';
      const ticketId = notification.ticketId || notification.ticket_id;
      const studentId = notification.studentId || notification.student_id;
      const notificationType = notification.type || '';

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }

      if (ticketId) {
        return `instructor.html?ticketId=${ticketId}`;
      }

      if (['new_enrollment', 'course_enrollment', 'enrollment_request'].includes(notificationType) && courseId) {
        const search = new URLSearchParams({ courseId, openEnrollment: '1' });
        if (studentId) {
          search.set('studentId', studentId);
        }
        return `instructor.html?${search.toString()}`;
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

    async markNotificationRead(fb, notificationId) {
      await fb.updateDoc(fb.doc(fb.db, 'notifications', notificationId), {
        read: true,
        updated_at: fb.serverTimestamp()
      });
    },

    async handleNotification(notification) {
      const fb = await _fbInstructorPage;
      await this.markNotificationRead(fb, notification.id);
      this.showNotifications = false;
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;

      this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
      this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },

    async markAllNotificationsRead() {
      const fb = await _fbInstructorPage;
      const batch = fb.writeBatch(fb.db);
      this.notifications.forEach(n => {
        const ref = fb.doc(fb.db, 'notifications', n.id);
        batch.update(ref, { read: true, updated_at: fb.serverTimestamp() });
      });
      await batch.commit();
      this.notifications = [];
      this.unreadCount = 0;
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];
    },

    async deleteNotification(notification) {
      const fb = await _fbInstructorPage;
      await this.markNotificationRead(fb, notification.id);
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;
      this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
      this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);
    }
  };
};
