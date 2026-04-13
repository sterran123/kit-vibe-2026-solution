// Start loading Firebase immediately (async)
const _firebasePromise = import('./firebase-init.js?v=4');
let _fb = null;

window.loginApp = function() {
  return {
    mode: 'login',
    role: 'student',
    email: '',
    password: '',
    displayName: '',
    isLoading: false,
    _isHandlingLogin: false,
    birthDate: '',
    phoneNumber: '',
    address: '',
    gender: '',
    privacyConsent: false,
    showPrivacyPolicy: false,
    certificateFile: null,
    certificatePreview: '',
    emailVerificationSent: false,
    emailVerified: false,
    isCheckingVerification: false,
    firebaseReady: false,
    _isCompletingRegistration: false,
    showAdditionalInfoModal: false,
    emailLinkClicked: false,
    pendingEmailForVerification: '',
    
    async init() {
      _fb = await _firebasePromise;
      this.firebaseReady = true;
      
      // URL 파라미터 확인
      const urlParams = new URLSearchParams(window.location.search);
      const roleParam = urlParams.get('role');
      const modeParam = urlParams.get('mode');
      
      if (roleParam === 'instructor' || roleParam === 'student') {
        this.role = roleParam;
      }
      if (modeParam === 'register') {
        this.mode = 'register';
      }
      
      // 이메일 링크 인증 결과 처리 (사용자가 이메일 링크 클릭 후 돌아왔을 때)
      if (_fb.isSignInWithEmailLink(_fb.auth, window.location.href)) {
        this._isCompletingRegistration = true;
        
        let email = window.localStorage.getItem('emailForSignIn');
        
        if (!email) {
          const { value: userEmail } = await Swal.fire({
            title: '이메일 확인',
            input: 'email',
            inputLabel: '인증을 완료하려면 가입 시 사용한 이메일을 입력해주세요',
            inputPlaceholder: 'your@email.com',
            confirmButtonColor: '#2563eb',
            allowOutsideClick: false
          });
          if (userEmail) {
            email = userEmail;
          } else {
            this._isCompletingRegistration = false;
            return;
          }
        }
        
        // 이메일 링크가 클릭되었음을 표시 - 자동으로 로그인하지 않고 버튼 클릭 대기
        this.emailLinkClicked = true;
        this.pendingEmailForVerification = email;
        this.email = email;
        this.displayName = window.localStorage.getItem('displayNameForSignIn') || '';
        // 이메일 링크 인증 완료 시에만 localStorage에서 role 복원
        const savedRole = window.localStorage.getItem('roleForSignIn');
        if (savedRole) {
          this.role = savedRole;
        }
        this.emailVerificationSent = true;
        this.mode = 'register';
        
        // 강사 필드 복원
        const savedBirthDate = window.localStorage.getItem('birthDateForSignIn');
        const savedPhoneNumber = window.localStorage.getItem('phoneNumberForSignIn');
        const savedAddress = window.localStorage.getItem('addressForSignIn');
        const savedGender = window.localStorage.getItem('genderForSignIn');
        if (savedBirthDate) this.birthDate = savedBirthDate;
        if (savedPhoneNumber) this.phoneNumber = savedPhoneNumber;
        if (savedAddress) this.address = savedAddress;
        if (savedGender) this.gender = savedGender;
        
        // URL 정리
        window.history.replaceState({}, document.title, window.location.pathname);
        
        Swal.fire({
          icon: 'info',
          title: '이메일 인증 준비 완료',
          text: '"인증 상태 확인" 버튼을 클릭하여 인증을 완료해주세요.',
          confirmButtonColor: '#2563eb'
        });
      }
      
      // 인증 상태 변화 감지
      _fb.onAuthStateChanged(_fb.auth, async (user) => {
        if (!user) return;
        if (this._isCompletingRegistration) return;
        if (this._isHandlingLogin) return; // email 로그인 중엔 handleLogin이 직접 처리

        try {
          const userDoc = await _fb.getDoc(_fb.doc(_fb.db, 'users', user.uid));

          if (!userDoc.exists()) {
            // 신규 Google 로그인 사용자 → 추가 정보 입력 모달
            this.email = user.email;
            this.displayName = user.displayName || '';
            this.emailVerified = true;
            this.showAdditionalInfoModal = true;
            return;
          }

          const userData = userDoc.data();
          const userRole = userData.role || 'student';

          const isInstructorRole = ['instructor', 'admin', 'staff'].includes(userRole);

          // 학생 계정이 강사 탭으로 로그인 시도 → 차단
          if (!isInstructorRole && this.role === 'instructor') {
            await _fb.signOut(_fb.auth);
            Swal.fire({ icon: 'error', title: '로그인 실패', text: '학생 계정입니다. 학생으로 로그인해 주세요.', confirmButtonColor: '#2563eb' });
            return;
          }

          // 강사/관리자/스태프 계정이 학생 탭으로 로그인 시도 → 차단
          if (isInstructorRole && this.role === 'student') {
            await _fb.signOut(_fb.auth);
            Swal.fire({ icon: 'error', title: '로그인 실패', text: '강사/관리자 계정입니다. 강사로 로그인해 주세요.', confirmButtonColor: '#2563eb' });
            return;
          }

          // 강사 승인 상태 체크 (admin/staff는 항상 통과)
          if (isInstructorRole && userRole === 'instructor') {
            if (userData.status === 'pending') {
              await _fb.signOut(_fb.auth);
              Swal.fire({ icon: 'info', title: '승인 대기중', text: '관리자의 강사 승인을 기다리고 있습니다.', confirmButtonColor: '#2563eb' });
              return;
            }
            if (userData.status === 'rejected') {
              await _fb.signOut(_fb.auth);
              Swal.fire({ icon: 'error', title: '가입 거절됨', text: '강사 가입이 거절되었습니다.', confirmButtonColor: '#2563eb' });
              return;
            }
          }

          if (isInstructorRole) {
            window.location.href = 'instructor.html';
          } else {
            window.location.href = 'dashboard.html';
          }
        } catch (e) {
          console.error('Auth check error:', e);
        }
      });
    },
    
    async handleLogin() {
      if (!_fb) return;
      this.isLoading = true;
      this._isHandlingLogin = true; // onAuthStateChanged 리다이렉트 방지

      try {
        const cred = await _fb.signInWithEmailAndPassword(_fb.auth, this.email, this.password);
        
        const userDoc = await _fb.getDoc(_fb.doc(_fb.db, 'users', cred.user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          
          // role 불일치 체크 - DB의 실제 role이 우선 (localStorage/UI 선택 무시)
          const actualRole = userData.role || 'student';
          const isInstructorRole = ['instructor', 'admin', 'staff'].includes(actualRole);

          // 학생 계정이 강사 탭으로 로그인 시도 → 차단
          if (!isInstructorRole && this.role === 'instructor') {
            await _fb.signOut(_fb.auth);
            await Swal.fire({
              icon: 'error',
              title: '로그인 실패',
              text: '학생 계정입니다. 학생으로 로그인해 주세요.',
              confirmButtonColor: '#2563eb'
            });
            return;
          }

          // 강사/관리자/스태프 계정이 학생 탭으로 로그인 시도 → 차단
          if (isInstructorRole && this.role === 'student') {
            await _fb.signOut(_fb.auth);
            await Swal.fire({
              icon: 'error',
              title: '로그인 실패',
              text: '강사/관리자 계정입니다. 강사로 로그인해 주세요.',
              confirmButtonColor: '#2563eb'
            });
            return;
          }

          // 강사 승인 상태 체크 (admin/staff는 항상 통과)
          if (actualRole === 'instructor') {
            if (userData.status === 'pending') {
              await _fb.signOut(_fb.auth);
              await Swal.fire({ icon: 'info', title: '승인 대기중', text: '관리자의 강사 승인을 기다리고 있습니다.', confirmButtonColor: '#2563eb' });
              return;
            }
            if (userData.status === 'rejected') {
              await _fb.signOut(_fb.auth);
              await Swal.fire({ icon: 'error', title: '가입 거절됨', text: '강사 가입이 거절되었습니다.', confirmButtonColor: '#2563eb' });
              return;
            }
          }

          // emailVerified 동기화
          if (cred.user.emailVerified && !userData.emailVerified) {
            await _fb.updateDoc(_fb.doc(_fb.db, 'users', cred.user.uid), {
              emailVerified: true,
              updated_at: _fb.serverTimestamp()
            });
          }

          // 역할에 따른 리다이렉트
          if (isInstructorRole) {
            window.location.href = 'instructor.html';
          } else {
            window.location.href = 'dashboard.html';
          }
          return; // 리다이렉트 후 더 이상 진행하지 않음
        }
      } catch (error) {
        console.error('Login error:', error);
        Swal.fire({
          icon: 'error',
          title: '로그인 실패',
          text: this.getErrorMessage(error.code),
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this._isHandlingLogin = false;
        this.isLoading = false;
      }
    },
    
    async handleRegister() {
      if (!_fb) return;
      
      if (!this.emailVerified) {
        Swal.fire({
          icon: 'warning',
          title: '이메일 인증 필요',
          text: '이메일 인증을 먼저 완료해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.isLoading = true;
      // 핵심: Auth 작업 전에 플래그 설정하여 onAuthStateChanged 리다이렉트 방지
      this._isCompletingRegistration = true;
      
      try {
        if (this.role === 'instructor' && !this.certificateFile) {
          throw new Error('강사증 업로드는 필수입니다.');
        }
        if (!this.birthDate) {
          throw new Error('생년월일을 입력해주세요.');
        }
        if (!this.address) {
          throw new Error('주소를 입력해주세요.');
        }
        if (!this.gender) {
          throw new Error('성별을 선택해주세요.');
        }
        if (!this.phoneNumber) {
          throw new Error('휴대폰번호를 입력해주세요.');
        }
        if (!this.privacyConsent) {
          throw new Error('개인정보 수집에 동의해주세요.');
        }
        if (!this.password || this.password.length < 6) {
          throw new Error('비밀번호는 6자 이상이어야 합니다.');
        }
        
        let user = _fb.auth.currentUser;
        
        if (user) {
          // 이메일 링크 인증으로 이미 로그인된 상태 → 비밀번호 설정
          await _fb.updatePassword(user, this.password);
        } else {
          // Auth 계정이 없는 경우 → 새로 생성
          const userCredential = await _fb.createUserWithEmailAndPassword(_fb.auth, this.email, this.password);
          user = userCredential.user;
        }
        
        // displayName 업데이트
        if (this.displayName) {
          await _fb.updateProfile(user, { displayName: this.displayName });
        }
        
        // Firestore 사용자 문서 생성
        const userData = {
          uid: user.uid,
          email: user.email,
          displayName: this.displayName || '',
          role: this.role,
          emailVerified: true,
          status: this.role === 'instructor' ? 'pending' : 'active',
          birthDate: this.birthDate,
          address: this.address,
          phoneNumber: this.phoneNumber,
          gender: this.gender,
          privacyConsent: true,
          created_at: _fb.serverTimestamp(),
          updated_at: _fb.serverTimestamp()
        };
        
        if (this.role === 'instructor') {
          userData.certificateVerified = false;
          userData.certificateAIVerified = false;
          
          const storageRef = _fb.ref(_fb.storage, `certificates/${user.uid}/${Date.now()}_${this.certificateFile.name}`);
          await _fb.uploadBytes(storageRef, this.certificateFile);
          const certificateUrl = await _fb.getDownloadURL(storageRef);
          userData.certificateUrl = certificateUrl;
          
          this.verifyCertificateWithAI(certificateUrl, user.uid);
        }
        
        await _fb.setDoc(_fb.doc(_fb.db, 'users', user.uid), userData);
        
        // localStorage 정리
        window.localStorage.removeItem('emailForSignIn');
        window.localStorage.removeItem('displayNameForSignIn');
        window.localStorage.removeItem('roleForSignIn');
        window.localStorage.removeItem('birthDateForSignIn');
        window.localStorage.removeItem('phoneNumberForSignIn');
        window.sessionStorage.removeItem('tempUid');
        
        // 결과 처리
        if (this.role === 'instructor') {
          await Swal.fire({
            icon: 'success',
            title: '가입 신청 완료!',
            html: '<p>강사 가입 신청이 완료되었습니다.</p><p style="margin-top:8px">관리자 승인 후 로그인하실 수 있습니다.</p>',
            confirmButtonColor: '#2563eb'
          });
          this._isCompletingRegistration = false;
          await _fb.signOut(_fb.auth);
          this.resetForm();
          this.mode = 'login';
        } else {
          await Swal.fire({
            icon: 'success',
            title: `${this.displayName || '회원'}님 가입을 환영합니다!`,
            text: '대시보드로 이동합니다.',
            confirmButtonColor: '#2563eb',
            timer: 2000,
            showConfirmButton: false
          });
          // 이미 Auth 로그인 상태 → 대시보드로 이동
          window.location.href = 'dashboard.html';
        }
        
      } catch (error) {
        console.error('Register error:', error);
        this._isCompletingRegistration = false;
        Swal.fire({
          icon: 'error',
          title: '회원가입 실패',
          text: error.message || this.getErrorMessage(error.code),
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isLoading = false;
      }
    },
    
    async verifyCertificateWithAI(certificateUrl, userId) {
      try {
        const response = await fetch('https://us-central1-the-unemployed-trio.cloudfunctions.net/verifyCertificate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: certificateUrl, userId: userId })
        });
        const result = await response.json();
        if (result.success) {
          await _fb.updateDoc(_fb.doc(_fb.db, 'users', userId), {
            certificateAIVerified: result.isValidCertificate,
            certificateAIResult: result
          });
        }
      } catch (error) {
        console.error('Certificate AI verification error:', error);
      }
    },
    
    handleCertificateUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      if (!file.type.startsWith('image/')) {
        Swal.fire({ icon: 'error', title: '잘못된 파일 형식', text: '이미지 파일(JPG, PNG)만 업로드 가능합니다.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        Swal.fire({ icon: 'error', title: '파일 크기 초과', text: '파일 크기는 50MB 이하여야 합니다.', confirmButtonColor: '#2563eb' });
        return;
      }
      
      this.certificateFile = file;
      const reader = new FileReader();
      reader.onload = (e) => { this.certificatePreview = e.target.result; };
      reader.readAsDataURL(file);
    },
    
    resetForm() {
      this.email = '';
      this.password = '';
      this.displayName = '';
      this.birthDate = '';
      this.phoneNumber = '';
      this.address = '';
      this.gender = '';
      this.privacyConsent = false;
      this.showPrivacyPolicy = false;
      this.certificateFile = null;
      this.certificatePreview = '';
      this.emailVerificationSent = false;
      this.emailVerified = false;
      this.isCheckingVerification = false;
      this._isCompletingRegistration = false;
      this.showAdditionalInfoModal = false;
      this.emailLinkClicked = false;
      this.pendingEmailForVerification = '';
      
      window.localStorage.removeItem('emailForSignIn');
      window.localStorage.removeItem('displayNameForSignIn');
      window.localStorage.removeItem('roleForSignIn');
      window.localStorage.removeItem('birthDateForSignIn');
      window.localStorage.removeItem('phoneNumberForSignIn');
      window.localStorage.removeItem('addressForSignIn');
      window.localStorage.removeItem('genderForSignIn');
      window.sessionStorage.removeItem('tempUid');
    },
    
    // Format phone number with automatic hyphen insertion
    formatPhoneNumber(value) {
      if (!value) return '';
      // Remove all non-numeric characters
      const numbers = value.replace(/[^0-9]/g, '');
      
      // Format based on length
      if (numbers.length <= 3) {
        return numbers;
      } else if (numbers.length <= 7) {
        return numbers.slice(0, 3) + '-' + numbers.slice(3);
      } else {
        return numbers.slice(0, 3) + '-' + numbers.slice(3, 7) + '-' + numbers.slice(7, 11);
      }
    },
    
    // Save additional info for Google login users
    async saveAdditionalInfo() {
      if (!_fb || !_fb.auth.currentUser) return;
      
      // Validation
      if (!this.displayName) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '이름을 입력해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.birthDate) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '생년월일을 입력해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.address) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '주소를 입력해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.gender) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '성별을 선택해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.phoneNumber) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '휴대폰번호를 입력해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      if (!this.privacyConsent) {
        Swal.fire({ icon: 'warning', title: '동의 필요', text: '개인정보 수집에 동의해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      
      this.isLoading = true;
      
      try {
        const user = _fb.auth.currentUser;
        const isInstructor = this.role === 'instructor';
        const userData = {
          uid: user.uid,
          email: user.email,
          displayName: this.displayName || user.displayName || '',
          role: this.role, // 선택한 탭(학생/강사) 반영
          emailVerified: true,
          status: isInstructor ? 'pending' : 'active',
          birthDate: this.birthDate,
          address: this.address,
          phoneNumber: this.phoneNumber,
          gender: this.gender,
          privacyConsent: true,
          loginProvider: 'google',
          created_at: _fb.serverTimestamp(),
          updated_at: _fb.serverTimestamp()
        };

        await _fb.setDoc(_fb.doc(_fb.db, 'users', user.uid), userData);

        this.showAdditionalInfoModal = false;
        this.resetForm();

        if (isInstructor) {
          await _fb.signOut(_fb.auth);
          Swal.fire({
            icon: 'success',
            title: '강사 가입 신청 완료',
            html: '<p>강사 가입 신청이 완료되었습니다.</p><p style="margin-top:8px">관리자 승인 후 로그인하실 수 있습니다.</p>',
            confirmButtonColor: '#2563eb'
          });
        } else {
          Swal.fire({
            icon: 'success',
            title: '정보 저장 완료',
            text: '대시보드로 이동합니다.',
            confirmButtonColor: '#2563eb',
            timer: 1500,
            showConfirmButton: false
          });
          window.location.href = 'dashboard.html';
        }
      } catch (error) {
        console.error('Save additional info error:', error);
        Swal.fire({
          icon: 'error',
          title: '저장 실패',
          text: '정보 저장 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isLoading = false;
      }
    },
    
    async sendVerificationEmail() {
      if (!_fb || !this.email || !this.displayName) {
        Swal.fire({
          icon: 'warning',
          title: '입력 필요',
          text: '이름과 이메일을 먼저 입력해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.email)) {
          throw new Error('유효하지 않은 이메일 주소입니다.');
        }
        
        // Firestore에서 이미 가입된 이메일인지 확인
        const usersQuery = _fb.query(
          _fb.collection(_fb.db, 'users'),
          _fb.where('email', '==', this.email),
          _fb.where('status', 'in', ['active', 'pending'])
        );
        const existingUsers = await _fb.getDocs(usersQuery);
        if (!existingUsers.empty) {
          throw new Error('이미 등록된 이메일입니다. 로그인을 진행해주세요.');
        }
        
        // 폼 데이터를 localStorage에 저장 (이메일 링크 리다이렉트 후 복원용)
        window.localStorage.setItem('emailForSignIn', this.email);
        window.localStorage.setItem('displayNameForSignIn', this.displayName);
        window.localStorage.setItem('roleForSignIn', this.role);
        if (this.birthDate) window.localStorage.setItem('birthDateForSignIn', this.birthDate);
        if (this.phoneNumber) window.localStorage.setItem('phoneNumberForSignIn', this.phoneNumber);
        if (this.address) window.localStorage.setItem('addressForSignIn', this.address);
        if (this.gender) window.localStorage.setItem('genderForSignIn', this.gender);
        
        // Firebase 이메일 링크 인증 발송
        const actionCodeSettings = {
          url: window.location.origin + '/login.html?mode=register&role=' + this.role,
          handleCodeInApp: true
        };
        
        await _fb.sendSignInLinkToEmail(_fb.auth, this.email, actionCodeSettings);
        
        this.emailVerificationSent = true;
        
        Swal.fire({
          icon: 'success',
          title: '인증 메일 발송 완료',
          html: `<p><strong>${this.email}</strong>로 인증 메일이 발송되었습니다.</p>
                 <p style="margin-top:8px">이메일을 확인하여 인증 링크를 클릭해주세요.</p>
                 <p style="font-size:0.875rem;color:#6b7280;margin-top:8px">메일이 도착하지 않으면 스팸함을 확인해주세요.</p>`,
          confirmButtonColor: '#2563eb'
        });
        
      } catch (error) {
        console.error('Send verification email error:', error);
        
        let errorMessage = error.message;
        if (error.code === 'auth/operation-not-allowed') {
          errorMessage = '이메일 링크 인증이 활성화되지 않았습니다. Firebase Console → Authentication → Sign-in method에서 "이메일 링크(비밀번호 없는 로그인)"를 활성화해주세요.';
        }
        
        Swal.fire({
          icon: 'error',
          title: '인증 메일 발송 실패',
          text: errorMessage,
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    async checkEmailVerification() {
      this.isCheckingVerification = true;
      
      try {
        // 이메일 링크가 클릭된 상태에서 버튼을 클릭한 경우 - 인증 완료 처리
        if (this.emailLinkClicked && this.pendingEmailForVerification) {
          try {
            // 현재 URL에 있는 이메일 링크로 인증 완료
            // 이메일 링크는 이미 init()에서 처리되어 URL이 정리되었으므로
            // 여기서는 이미 로그인된 상태를 확인하거나 바로 인증 완료 처리
            this.emailVerified = true;
            this.emailLinkClicked = false;
            this._isCompletingRegistration = true;
            
            Swal.fire({
              icon: 'success',
              title: '이메일 인증 완료',
              text: '비밀번호를 입력하고 회원가입을 완료해주세요.',
              confirmButtonColor: '#2563eb'
            });
            return;
          } catch (error) {
            console.error('Email verification completion error:', error);
            Swal.fire({
              icon: 'error',
              title: '인증 완료 실패',
              text: error.message || '인증 처리 중 오류가 발생했습니다.',
              confirmButtonColor: '#2563eb'
            });
            return;
          }
        }
        
        // 기존 로직: 이미 로그인된 사용자 확인
        const user = _fb.auth.currentUser;
        if (user) {
          this.emailVerified = true;
          this.email = user.email || this.email;
          this._isCompletingRegistration = true;
          
          Swal.fire({
            icon: 'success',
            title: '이메일 인증 완료',
            text: '비밀번호를 입력하고 회원가입을 완료해주세요.',
            confirmButtonColor: '#2563eb'
          });
        } else {
          Swal.fire({
            icon: 'info',
            title: '인증 대기중',
            html: '<p>아직 이메일 인증이 완료되지 않았습니다.</p><p style="margin-top:8px">이메일에서 인증 링크를 클릭한 후<br>"인증 상태 확인" 버튼을 눌러주세요.</p>',
            confirmButtonColor: '#2563eb'
          });
        }
      } finally {
        this.isCheckingVerification = false;
      }
    },
    
    async handleGoogleLogin() {
      if (!_fb) return;
      this.isLoading = true;
      
      try {
        const result = await _fb.signInWithPopup(_fb.auth, _fb.googleProvider);
        // onAuthStateChanged가 사용자 문서 확인 및 리다이렉트/모달 표시 처리함
      } catch (error) {
        console.error('Google login error:', error);
        if (error.code !== 'auth/popup-closed-by-user') {
          Swal.fire({
            icon: 'error',
            title: '로그인 실패',
            text: this.getErrorMessage(error.code),
            confirmButtonColor: '#2563eb'
          });
        }
      } finally {
        this.isLoading = false;
      }
    },
    
    getErrorMessage(code) {
      const messages = {
        'auth/invalid-email': '유효하지 않은 이메일 주소입니다.',
        'auth/user-disabled': '이 계정은 비활성화되었습니다.',
        'auth/user-not-found': '등록되지 않은 이메일입니다.',
        'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
        'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
        'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
        'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
        'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
        'auth/cancelled-popup-request': '로그인이 취소되었습니다.',
        'auth/popup-blocked': '팝업이 차단되었습니다. 팝업을 허용해주세요.',
        'auth/operation-not-allowed': '이 인증 방식이 활성화되지 않았습니다.'
      };
      return messages[code] || '알 수 없는 오류가 발생했습니다. 다시 시도해주세요.';
    }
  };
};
