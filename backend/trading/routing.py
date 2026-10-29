from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/bots/(?P<run_id>[0-9a-f]{32})/$", consumers.BotConsumer.as_asgi()),
    re_path(r"ws/activity/$", consumers.UserConsumer.as_asgi()),
]
