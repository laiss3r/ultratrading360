from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("strategies", views.StrategyViewSet, basename="strategy")
router.register("bots", views.BotRunViewSet, basename="bot")
router.register("trades", views.TradeViewSet, basename="trade")

urlpatterns = [
    path("health/", views.health, name="health"),
    path("deriv/connect/", views.DerivConnectView.as_view(), name="deriv-connect"),
    path("deriv/accounts/", views.DerivAccountsView.as_view(), name="deriv-accounts"),
    path("deriv/disconnect/", views.DerivDisconnectView.as_view(), name="deriv-disconnect"),
    path("deriv/acknowledge-real/", views.AcknowledgeRealTradingView.as_view(), name="deriv-acknowledge"),
    path("risk/", views.RiskProfileView.as_view(), name="risk-profile"),
    path("", include(router.urls)),
]
