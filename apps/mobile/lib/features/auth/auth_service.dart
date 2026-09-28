import '../../core/api/api_client.dart';
import '../../core/storage/token_storage.dart';

class AuthService {
  AuthService({
    ApiClient? apiClient,
    TokenStorage? tokenStorage,
  })  : _apiClient = apiClient ?? ApiClient(),
        _tokenStorage = tokenStorage ?? TokenStorage();

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;

  Future<LoginResult> login({
    required String phone,
    required String pin,
  }) async {
    final response = await _apiClient.post(
      '/auth/login',
      body: <String, dynamic>{
        'phone': phone,
        'pin': pin,
      },
    );

    final accessToken = response['accessToken'];

    if (accessToken is! String || accessToken.isEmpty) {
      throw const AuthException(
        'Le serveur n’a pas retourné de token d’authentification.',
      );
    }

    await _tokenStorage.saveAccessToken(accessToken);

    final user = response['user'];
    final wallet = response['wallet'];

    return LoginResult(
      accessToken: accessToken,
      user: user is Map<String, dynamic>
          ? user
          : <String, dynamic>{},
      wallet: wallet is Map<String, dynamic>
          ? wallet
          : <String, dynamic>{},
    );
  }

  /// Crée un compte. Le serveur répond comme pour une connexion :
  /// token, utilisateur et wallet (le résultat est donc un
  /// [LoginResult] et l'utilisateur est directement connecté).
  Future<LoginResult> register({
    required String firstName,
    required String lastName,
    required String phone,
    required String pin,
    String? email,
  }) async {
    final trimmedEmail = email?.trim() ?? '';

    final response = await _apiClient.post(
      '/auth/register',
      body: <String, dynamic>{
        'firstName': firstName,
        'lastName': lastName,
        'phone': phone,
        'pin': pin,
        if (trimmedEmail.isNotEmpty) 'email': trimmedEmail,
      },
    );

    return _saveSession(response);
  }

  Future<void> logout() async {
    await _tokenStorage.deleteAccessToken();
  }

  Future<String?> getAccessToken() async {
    return _tokenStorage.readAccessToken();
  }

  /// Lit la réponse d'authentification, enregistre le token
  /// et retourne la session.
  Future<LoginResult> _saveSession(
    Map<String, dynamic> response,
  ) async {
    final accessToken = response['accessToken'];

    if (accessToken is! String || accessToken.isEmpty) {
      throw const AuthException(
        'Le serveur n’a pas retourné de token d’authentification.',
      );
    }

    await _tokenStorage.saveAccessToken(accessToken);

    final user = response['user'];
    final wallet = response['wallet'];

    return LoginResult(
      accessToken: accessToken,
      user: user is Map<String, dynamic>
          ? user
          : <String, dynamic>{},
      wallet: wallet is Map<String, dynamic>
          ? wallet
          : <String, dynamic>{},
    );
  }
}

class LoginResult {
  const LoginResult({
    required this.accessToken,
    required this.user,
    required this.wallet,
  });

  final String accessToken;
  final Map<String, dynamic> user;
  final Map<String, dynamic> wallet;
}

class AuthException implements Exception {
  const AuthException(this.message);

  final String message;

  @override
  String toString() {
    return 'AuthException: $message';
  }
}